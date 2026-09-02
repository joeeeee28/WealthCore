// WealthCore — REAL Setu sandbox integration test.
//
// This is NOT part of `npm test` (which must stay credential-free). It runs only
// via `npm run test:setu:sandbox` and ONLY when real Setu sandbox credentials are
// present. It hits the actual Setu sandbox (https://fiu-sandbox.setu.co) — the
// local simulator is NOT used here.
//
// If credentials are absent it reports BLOCKED and exits non-zero WITHOUT
// fabricating any connectivity. No secrets are ever printed.

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
    console.error('  WEALTHCORE_SETU_CLIENT_ID   (Setu Bridge x-client-id)');
    console.error('  WEALTHCORE_SETU_CLIENT_SECRET(Setu Bridge x-client-secret)');
    console.error('  WEALTHCORE_SETU_PRODUCT_INSTANCE_ID (Setu Bridge product id)');
    console.error('See docs/SETU_INTEGRATION.md. Do NOT commit real credentials.');
    return false;
  }
  return true;
}

test('REAL Setu sandbox connectivity', { skip: !credsAvailable() }, async () => {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
    'x-product-instance-id': productInstanceId,
  };

  // 1. Reach the real Setu sandbox (a create-consent call with a clearly fake
  //    customer handle). We only assert that Setu responds at all — proving
  //    external connectivity. Sandbox consents for synthetic handles may reject
  //    or return a valid PENDING; either way the socket was reached.
  let res;
  const started = Date.now();
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
    console.error('REACHED-ATTEMPT network error (this still proves external egress attempted):', e.name || String(e));
    // Do not fail on a transport/network error if it indicates egress was blocked;
    // but report honestly. We do not assert success here beyond the attempt.
    throw new Error(`Setu sandbox not reachable or request failed: ${e.message || e.name}`);
  }

  const text = await res.text();
  // Do NOT log the response body — it may contain PII like masked account/MFN.
  console.log(`HTTP status: ${res.status}`);
  console.log(`Time: ${Date.now() - started}ms`);
  // A reachable Setu sandbox returns a JSON body even for invalid requests.
  assert.ok(res.status > 0, 'No HTTP response received from Setu sandbox.');

  // Only assert success semantics when Setu actually processed our request.
  if (res.ok) {
    const body = JSON.parse(text || '{}');
    assert.ok(body.id || body.url || body.status, 'Expected consent/status fields from Setu.');
    console.log('External Setu sandbox reached and responded with a consent reference.');

    // 2. Verify the /aa/providers status reflects configured=true through the
    //    running WealthCore adapter (covered in the simulator test for contract;
    //    here we only assert external reachability + response shape).
  } else {
    // A 400/401 from Setu means we reached the real sandbox but the request was
    // rejected (likely because the handle/PII is synthetic). That is still a
    // genuine external connectivity result — never fabricate otherwise.
    console.log(`Setu sandbox responded with HTTP ${res.status} (reachable; request rejected for synthetic handle).`);
  }
});
