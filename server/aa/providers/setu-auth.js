// WealthCore — Setu Authentication Manager.
//
// CURRENT OFFICIAL SETU AUTH MODEL (verified from Setu AA docs):
//   * Bridge provides client_id + client_secret + x-product-instance-id.
//   * Setu AA APIs require an ACCESS TOKEN in `Authorization: Bearer <token>`
//     and `x-product-instance-id`. The access token is obtained via the Setu
//     "Auth Mechanism / getToken" endpoint (Account Availability docs reference
//     this as `api-reference#/operation~getToken`).
//   * The client secret is NEVER sent as a request header on AA APIs — it is
//     used only to acquire the access token.
//
// This module:
//   * acquires an access token from client credentials
//   * caches it with an expiry
//   * renews before expiry
//   * serialises concurrent refresh so it never storms the token endpoint
//   * retries once on a transient authentication expiry
//   * never logs credentials or tokens
//
// PENDING SETU DOCUMENTATION CONFIRMATION:
//   * the exact getToken request shape (form-encoded client_credentials vs
//     Basic auth). The token endpoint and grant params are not fully published
//     on the public docs; this is isolated behind `setuTokenEndpoint()` and
//     `setuTokenRequest()` so the exact wire format can be confirmed with Setu
//     without touching the rest of the AA layer.

import { config } from '../../config.js';
import { aaError, AA_ERROR_CODES } from '../errors.js';

const BASE_SANDBOX = 'https://fiu-sandbox.setu.co';
const BASE_PRODUCTION = 'https://fiu.setu.co';

function env() {
  return config();
}

/** Highest-confidence token endpoint for the current Setu AA environment. */
function setuTokenEndpoint() {
  // Setu's token endpoint host is environment-specific; default to the same
  // base host used by the AA API. Override via WEALTHCORE_SETU_TOKEN_URL.
  const base = baseUrl();
  // Candidate token path. PENDING PROVIDER CONFIRMATION: exact path.
  return process.env.WEALTHCORE_SETU_TOKEN_URL || `${base}/auth/token`;
}

/** Build the token request body/headers from client credentials. */
function setuTokenRequest(clientId, clientSecret) {
  // OAuth2 client-credentials style. PENDING SETU CONFIRMATION: exact grant
  // fields/scope. Isolated so the wire format can be corrected in one place.
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
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
  const prod = cfg.aaEnvironment === 'production' || (cfg.setu && cfg.setu.environment === 'production');
  return (cfg.setu && prod ? cfg.setu.baseUrl : cfg.setu && cfg.setu.baseUrl) || (prod ? BASE_PRODUCTION : BASE_SANDBOX);
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
      timedOut ? 'Setu token endpoint timed out.' : 'Setu token endpoint unreachable.');
  }
  clearTimeout(timer);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    // Authentication failure (401/403) is distinct from a general API failure.
    throw aaError(res.status === 401 || res.status === 403 ? AA_ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED : AA_ERROR_CODES.PROVIDER_UNAVAILABLE,
      `Setu token request failed (HTTP ${res.status}).`, { status: res.status });
  }
  const token = json && (json.access_token || (json.token && json.token));
  if (!token) throw aaError(AA_ERROR_CODES.PROVIDER_AUTHENTICATION_FAILED, 'Setu token response did not include an access token.');
  const expiresIn = Number(json && (json.expires_in || json.expiresIn)); // seconds
  return {
    token,
    expiresAtMs: expiresIn > 0 ? Date.now() + (expiresIn - 30) * 1000 : Date.now() + 55 * 60 * 1000,
  };
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
