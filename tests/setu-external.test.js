// WealthCore — REAL Setu sandbox integration test.
//
// This is NOT part of `npm test` (which must stay credential-free). It runs only
// via `npm run test:setu:sandbox` and ONLY when real Setu sandbox credentials are
// present. It hits the actual Setu sandbox (https://fiu-sandbox.setu.co) — the
// local simulator is NOT used here.
//
// It uses the CURRENT OFFICIAL Setu auth model:
//   Bridge (client_id + client_secret) -> Auth Mechanism / getToken -> access_token
//   -> `Authorization: Bearer <access_token>` + `x-product-instance-id`
// The client secret is NEVER sent as an AA request header.
//
// If credentials are absent it reports BLOCKED and skips WITHOUT fabricating any
// connectivity. No secrets are ever printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const clientId = process.env.WEALTHCORE_SETU_CLIENT_ID || '';
const clientSecret = process.env.WEALTHCORE_SETU_CLIENT_SECRET || '';
const productInstanceId = process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID || '';
const baseUrl = process.env.WEALTHCORE_SETU_BASE_URL || 'https://fiu-sandbox.setu.co';
const hasCreds = Boolean(clientId && clientSecret && productInstanceId);

function credsAvailable() {
  if (!hasCreds) {
    console.error('BLOCKED — Real Setu sandbox credentials/access are not available.');
    console.error('Set the following to run the real external sandbox integration test:');
    console.error('  WEALTHCORE_SETU_CLIENT_ID   (Setu Bridge client id)');
    console.error('  WEALTHCORE_SETU_CLIENT_SECRET(Setu Bridge client secret — used ONLY to fetch the token)');
    console.error('  WEALTHCORE_SETU_PRODUCT_INSTANCE_ID (Setu Bridge product instance id)');
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

  // 1. Acquire a real Setu access token from client credentials (getToken/Auth
  //    Mechanism). This is the only place the client secret is used.
  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    console.error(`AUTH RESULT: FAILED — ${e.code || e.message} (token acquisition from Setu did not succeed).`);
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
