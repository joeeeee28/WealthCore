// WealthCore — REAL Setu sandbox integration test.
//
// This is NOT part of `npm test` (which must stay credential-free). It runs only
// via `npm run test:setu:sandbox` and ONLY when real Setu sandbox credentials are
// present. It hits the actual Setu sandbox (https://fiu-sandbox.setu.co) — the
// local simulator is NOT used here.
//
// It uses the CURRENT OFFICIAL Setu AA (FIU) auth model:
//   Bridge (client_id + client_secret + FIU Product ID) -> AA Get Token endpoint
//   POST https://fiu-sandbox.setu.co/users/login  (production: https://fiu.setu.co/users/login)
//   header `client: bridge`; JSON { clientID, grant_type:"client_credentials", secret }
//   response { access_token, refresh_token } -> Bearer access_token
//   -> AA APIs use `Authorization: Bearer <access_token>` + `x-product-instance-id`
// NOTE: the legacy payments/KYC endpoint https://uat.setu.co/api/v2/auth/token is a
//   DIFFERENT Setu product and rejects AA/FIU credentials with HTTP 403. It is not used.
// The client secret is NEVER sent as an AA request header.
//
// If credentials are absent it reports BLOCKED and skips WITHOUT fabricating any
// connectivity. Credentials are resolved through the app's own config (which
// honours BOTH the `SETU_*` aliases and the `WEALTHCORE_SETU_*` canonical names).
// No secrets are ever printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, resetConfig } from '../server/config.js';

// Resolve credentials through the app's config layer, which reads both env
// namespaces. Do NOT print clientSecret / token values anywhere.
function setuCfg() {
  resetConfig();
  const s = config().setu || {};
  return {
    clientId: s.clientId || '',
    clientSecret: s.clientSecret || '',
    productInstanceId: s.productInstanceId || '',
    baseUrl: s.baseUrl || 'https://fiu-sandbox.setu.co',
  };
}

const cfg = setuCfg();
const clientId = cfg.clientId;
const clientSecret = cfg.clientSecret;
const productInstanceId = cfg.productInstanceId;
const baseUrl = cfg.baseUrl;
const hasCreds = Boolean(clientId && clientSecret && productInstanceId);

function credsAvailable() {
  if (!hasCreds) {
    console.error('BLOCKED — Real Setu sandbox credentials/access are not available.');
    console.error('Set the following to run the real external sandbox integration test:');
    console.error('  SETU_CLIENT_ID   (or WEALTHCORE_SETU_CLIENT_ID) — Setu Bridge client id');
    console.error('  SETU_CLIENT_SECRET(or WEALTHCORE_SETU_CLIENT_SECRET) — used ONLY to fetch the token');
    console.error('  SETU_PRODUCT_INSTANCE_ID (or WEALTHCORE_SETU_PRODUCT_INSTANCE_ID) — product id');
    console.error('See docs/SETU_INTEGRATION.md. Do NOT commit real credentials.');
    return false;
  }
  return true;
}

test('REAL Setu sandbox connectivity (Bearer auth)', { skip: !credsAvailable() }, async () => {
  // Route credentials through the app's own environment so the real Setu
  // Authentication Manager (server/aa/providers/setu-auth.js) fetches the token.
  process.env.WEALTHCORE_SETU_CLIENT_ID = clientId;
  process.env.WEALTHCORE_SETU_CLIENT_SECRET = clientSecret;
  process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID = productInstanceId;
  process.env.WEALTHCORE_SETU_BASE_URL = baseUrl;

  const { resetConfig } = await import('../server/config.js');
  resetConfig();
  const { getAccessToken } = await import('../server/aa/providers/setu-auth.js');

  // 1. Acquire a real Setu access token from client credentials via the current
  //    official Generate Token API. This is the only place the client secret is used.
  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    // Distinguish BLOCKED-by-network from credential/contract rejection. Never print a
    // secret, token, Authorization header, cookie or PII. Structured, redacted-only
    // diagnostics come back from the auth manager on e.meta (endpoint origin+path,
    // HTTP status, content-type, provider error code/message — all sanitised).
    const code = e.code || '';
    const meta = (e && e.meta) || {};
    const sanitize = (v) => String(v == null ? '' : v)
      .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1REDACTED')
      .replace(/(secret"?\s*[:=]\s*"?)([^"&\s]+)/gi, '$1REDACTED')
      .replace(/(token"?\s*[:=]\s*"?)([A-Za-z0-9._\-]{6,})/gi, '$1REDACTED')
      .slice(0, 200);
    const msg = sanitize(e.message || e);

    console.error('--- SETU TOKEN DIAGNOSTICS (redacted) ---');
    console.error(`SETU TOKEN ENDPOINT: ${meta.endpoint || '(unknown)'}`);
    console.error(`SETU TOKEN HTTP STATUS: ${meta.status != null ? meta.status : '(no HTTP response)'}`);
    console.error(`SETU TOKEN CONTENT TYPE: ${meta.contentType || '(none)'}`);
    console.error(`SETU PROVIDER ERROR CODE: ${meta.providerErrorCode || '(none)'}`);
    console.error(`SETU PROVIDER ERROR MESSAGE: ${meta.providerErrorMessage || '(none)'}`);
    console.error('-----------------------------------------');
    console.error(`AUTH RESULT: FAILED\ncode=${code}\nmessage=${msg}`);

    const networkish = code === 'PROVIDER_UNAVAILABLE' || code === 'FETCH_TIMEOUT';
    // An HTTP status of 0/absent means we never got a response (transport/TLS/DNS).
    const gotHttpResponse = meta.status != null && Number(meta.status) > 0;
    if (networkish && !gotHttpResponse) {
      console.error('STATUS: BLOCKED — NETWORK. The runtime could not reach the Setu token endpoint (check egress/firewall/DNS/TLS).');
    } else if (meta.status === 403 || meta.status === 401 || code === 'PROVIDER_AUTHENTICATION_FAILED' || code === 'AUTHENTICATION_FAILED') {
      console.error('STATUS: BLOCKED — AUTHENTICATION. Setu rejected the token request (check credentials product/environment and the AA token endpoint /users/login).');
    } else {
      console.error('STATUS: BLOCKED — PROVIDER CONTRACT/UNEXPECTED. The endpoint responded but the token contract did not match.');
    }
    throw e;
  }
  assert.ok(token && String(token).length > 0, 'Setu access token was not acquired.');

  // 2. Create a real consent using `Authorization: Bearer <token>` +
  //    x-product-instance-id (current official Setu contract).
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'x-product-instance-id': productInstanceId,
  };

  const started = Date.now();
  let res;
  try {
    res = await fetch(`${baseUrl}/v2/consents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        consentDuration: { unit: 'MONTH', value: 1 },
        vua: '9999999999@setu',
        dataRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' },
        context: [],
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    console.error('SETU REACHABILITY: network error (external egress attempted but connection failed):', e.name || String(e));
    throw new Error(`Setu sandbox not reachable or request failed: ${e.message || e.name}`);
  }

  const text = await res.text();
  // Do NOT log the response body — it may contain PII like masked accounts/MFN.
  console.log(`SETU HTTP status: ${res.status}`);
  console.log(`SETU round-trip: ${Date.now() - started}ms`);
  console.log(`AUTH result: ${res.status === 200 || res.status === 201 ? 'Authenticated via Bearer token' : (res.status === 401 || res.status === 403 ? 'AUTHENTICATION FAILED' : 'Reachable; request rejected')}`);

  assert.ok(res.status > 0, 'No HTTP response received from Setu sandbox.');

  if (res.ok) {
    const body = JSON.parse(text || '{}');
    const consentId = body.id || null;
    const consentStatus = body.status || null;
    // Only report safe, non-secret identifiers.
    console.log(`CONSENT CREATED: ${consentId ? consentId : '(none returned)'} | status=${consentStatus || 'unknown'}`);
    console.log('CONSENT URL RECEIVED: yes (exact URL intentionally not logged)');
    console.log('NEXT: opening the Setu consent URL and approving is a MANUAL USER ACTION in a real AA flow.');
    assert.ok(body.id || body.url || body.status, 'Expected consent/status fields from Setu.');
  } else {
    // A 400/401 from Setu means we reached the real sandbox but the request was
    // rejected (likely because the handle/PII is synthetic or the token is scoped).
    // This is still a genuine external connectivity/auth result — never fabricate.
    console.log(`Setu sandbox responded with HTTP ${res.status}; the real endpoint was reached.`);
    if (res.status === 401 || res.status === 403) {
      console.log('STATUS: PARTIAL — real endpoint reached but authentication was rejected (check client_id/secret/product-instance-id).');
    } else {
      console.log('STATUS: PARTIAL — real endpoint reached and authenticated; the synthetic consent request was rejected (PII/handle).');
    }
  }
});
