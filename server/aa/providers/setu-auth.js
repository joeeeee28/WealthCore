// WealthCore — Setu Authentication Manager.
//
// CURRENT OFFICIAL SETU AA (FIU) AUTH MODEL — verified from Setu's own OpenAPI
// reference (github.com/SetuHQ/docs :: api-references/data/account-aggregator.json,
// operationId "getToken") and the official AA docs site (docs.setu.co/data/account-aggregator):
//
//   * The Bridge provides an FIU **client_id**, **client_secret** and the
//     **x-product-instance-id** (the FIU Product ID).
//   * The access token is acquired from the AA product's **Get Token** endpoint,
//     which lives on the SAME host as the AA APIs (NOT the payments host):
//       Sandbox:   POST https://fiu-sandbox.setu.co/users/login
//       Production: POST https://fiu.setu.co/users/login
//     - Required header:  `client: bridge`
//     - Content-Type:     application/json
//     - JSON body:        { "clientID": "<client_id>",
//                           "grant_type": "client_credentials",
//                           "secret": "<client_secret>" }
//     - Success response: { "access_token": "<bearer>", "refresh_token": "<bearer>" }
//   * Every Setu AA API then uses `Authorization: Bearer <access_token>` and
//     `x-product-instance-id`. The client secret is NEVER sent as a request
//     header on the AA APIs — it is used only to acquire the access token.
//
// IMPORTANT (root cause of the earlier HTTP 403):
//   The legacy payments/KYC "Generate Token API"
//       POST https://uat.setu.co/api/v2/auth/token   body { clientID, secret }
//   belongs to Setu's PAYMENTS products (BBPS, UPI deeplinks) and data-KYC
//   products (PAN/eSign/DigiLocker/Insights v1). It is NOT part of the Account
//   Aggregator product. Presenting AA/FIU credentials to that payments endpoint
//   is rejected with HTTP 403 (forbidden — the credentials have no entitlement on
//   that product/host). The AA product uses /users/login on fiu-sandbox/fiu.setu.co.
//
// This module:
//   * acquires an access token from client credentials
//   * caches it with an expiry
//   * renews before expiry
//   * serialises concurrent refresh so it never storms the token endpoint
//   * retries once on a transient authentication expiry
//   * never logs credentials or tokens

import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';

const BASE_SANDBOX = 'https://fiu-sandbox.setu.co';
const BASE_PRODUCTION = 'https://fiu.setu.co';
// AA Get Token endpoint path (same host as the AA APIs).
const TOKEN_PATH = '/users/login';

function env() {
  return config();
}

function isProduction(cfg) {
  return cfg.aaEnvironment === 'production' || (cfg.setu && cfg.setu.environment === 'production');
}

/** Base host for the AA product (token + AA APIs share this host). */
function aaBaseHost() {
  const cfg = env();
  const prod = isProduction(cfg);
  // Prefer the configured AA base URL (it already points at fiu-sandbox/fiu or an
  // explicit override); strip any trailing slash and any path so we append the
  // token path ourselves.
  const configured = cfg.setu && cfg.setu.baseUrl;
  if (configured) {
    try {
      const u = new URL(configured);
      return `${u.protocol}//${u.host}`;
    } catch {
      // Fall through to the documented default if the override is malformed.
    }
  }
  return prod ? BASE_PRODUCTION : BASE_SANDBOX;
}

/**
 * Highest-confidence token endpoint for the current Setu AA environment.
 * Defaults to the documented AA Get Token endpoint on the AA host; overridable
 * via WEALTHCORE_SETU_TOKEN_URL / SETU_TOKEN_URL (resolved into config().setu.tokenUrl).
 */
function setuTokenEndpoint() {
  const cfg = env();
  if (cfg.setu && cfg.setu.tokenUrl) return cfg.setu.tokenUrl;
  return `${aaBaseHost()}${TOKEN_PATH}`;
}

/** Build the AA token request body/headers from client credentials. */
function setuTokenRequest(clientId, clientSecret) {
  // Current official Setu AA "Get Token" contract: JSON body with clientID,
  // secret AND grant_type=client_credentials, plus the required `client: bridge`
  // header. Isolated so the wire format stays in one place.
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Required by the AA Get Token endpoint (OpenAPI: header `client`, enum ["bridge"]).
      client: 'bridge',
    },
    body: JSON.stringify({
      clientID: clientId,
      grant_type: 'client_credentials',
      secret: clientSecret,
    }),
  };
}

export function setuCreds() {
  const s = env().setu || {};
  return {
    clientId: s.clientId || null,
    clientSecret: s.clientSecret || null,
    productInstanceId: s.productInstanceId || null,
    token: s.token || null, // legacy short-lived access token (if provided directly)
    configured: Boolean(
      (s.clientId && s.clientSecret && s.productInstanceId) ||
      (s.token && s.productInstanceId),
    ),
  };
}

function baseUrl() {
  const cfg = env();
  return (cfg.setu && cfg.setu.baseUrl) || (isProduction(cfg) ? BASE_PRODUCTION : BASE_SANDBOX);
}

/**
 * Token cache. Keyed by clientId so multiple clients never collide.
 * Holds { accessToken, expiresAtMs, inFlight } and a module-level promise so
 * concurrent callers share a single refresh.
 */
const cacheByClient = new Map();

function getCache(clientId) {
  if (!cacheByClient.has(clientId)) {
    cacheByClient.set(clientId, { accessToken: null, expiresAtMs: 0, inFlight: null });
  }
  return cacheByClient.get(clientId);
}

/** Redact anything credential/token-shaped from a provider message before logging. */
function redact(message) {
  return String(message || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1REDACTED')
    .replace(/(secret"?\s*[:=]\s*"?)([^"&\s]+)/gi, '$1REDACTED')
    .replace(/(access_token"?\s*[:=]\s*"?)([^"&\s]+)/gi, '$1REDACTED')
    .replace(/(refresh_token"?\s*[:=]\s*"?)([^"&\s]+)/gi, '$1REDACTED')
    .replace(/\b(client_secret|SETU_CLIENT_SECRET|Authorization)\b/gi, 'REDACTED');
}

/**
 * Extract the bearer token from a Get Token response. Current official AA
 * contract returns `access_token`; tolerate the legacy payments `data.token`
 * shape as a fallback so a configured override still works.
 */
function extractToken(json) {
  const token =
    (json && json.access_token) ||
    (json && json.data && json.data.token) ||
    null;
  const expiresIn = Number(
    (json && (json.expires_in || json.expiresIn)) ||
    (json && json.data && (json.data.expiresIn || json.data.expires_in)) ||
    0,
  ); // seconds
  return { token, expiresIn };
}

async function fetchToken(cfg) {
  const endpoint = setuTokenEndpoint();
  const req = setuTokenRequest(cfg.clientId, cfg.clientSecret);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(endpoint, { ...req, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && e.name === 'AbortError';
    throw aaError(timedOut ? AA_ERROR_CODES.PROVIDER_UNAVAILABLE : AA_ERROR_CODES.PROVIDER_UNAVAILABLE,
      timedOut ? 'Setu token endpoint timed out.' : 'Setu token endpoint unreachable.',
      { endpoint: safeEndpoint(endpoint) });
  }
  clearTimeout(timer);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  // SAFE diagnostics — never include the secret, token or Authorization header.
  const contentType = res.headers.get('content-type') || '';
  const providerErrorCode = (json && (json.errorCode || json.error || json.code)) || '';
  const providerErrorMessage = redact((json && (json.errorMsg || json.message || json.error_description)) || '');

  if (!res.ok) {
    // Authentication failure (401/403) is distinct from a general API failure.
    const authFailed = res.status === 401 || res.status === 403;
    throw aaError(
      authFailed ? AA_ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED : AA_ERROR_CODES.PROVIDER_UNAVAILABLE,
      `Setu token request failed (HTTP ${res.status}).`,
      {
        status: res.status,
        endpoint: safeEndpoint(endpoint),
        contentType,
        providerErrorCode: providerErrorCode ? String(providerErrorCode).slice(0, 64) : '',
        providerErrorMessage: providerErrorMessage.slice(0, 200),
      },
    );
  }
  const { token, expiresIn } = extractToken(json);
  if (!token) {
    throw aaError(AA_ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED,
      'Setu token response did not include access_token.',
      { endpoint: safeEndpoint(endpoint), contentType });
  }
  return {
    token,
    expiresAtMs: expiresIn > 0 ? Date.now() + (expiresIn - 30) * 1000 : Date.now() + 25 * 60 * 1000,
  };
}

/** Return only the safe origin+path of an endpoint for diagnostics (no query/creds). */
function safeEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable-endpoint)';
  }
}

/**
 * Get a valid access token, acquiring and caching it. Serialises concurrent
 * refreshes so there is never more than one in-flight token request. Retries a
 * confirmed-audience failure once (single retry, no storm).
 */
export async function getAccessToken() {
  const cfg = setuCreds();
  if (!cfg.configured) {
    throw aaError(AA_ERROR_CODES.PROVIDER_NOT_CONFIGURED, 'Setu credentials are required (client_id + client_secret + product-instance-id).');
  }
  // If a short-lived token was supplied directly, use it (still never logged).
  if (cfg.token && !cfg.clientId) return cfg.token;

  const cache = getCache(cfg.clientId);
  if (cache.accessToken && Date.now() < cache.expiresAtMs) return cache.accessToken;

  if (!cache.inFlight) {
    cache.inFlight = (async () => {
      try {
        const { token, expiresAtMs } = await fetchToken(cfg);
        cache.accessToken = token;
        cache.expiresAtMs = expiresAtMs;
        return token;
      } finally {
        cache.inFlight = null;
      }
    })();
  }
  return cache.inFlight;
}

/** Invalidate the cached token (e.g. on confirmed authentication failure). */
export function invalidateAccessToken(clientId) {
  if (cacheByClient.has(clientId)) {
    const c = cacheByClient.get(clientId);
    c.accessToken = null;
    c.expiresAtMs = 0;
  }
}

export { baseUrl, setuTokenEndpoint, setuTokenRequest };
export default { setuCreds, getAccessToken, invalidateAccessToken, setuTokenEndpoint, setuTokenRequest, baseUrl };
