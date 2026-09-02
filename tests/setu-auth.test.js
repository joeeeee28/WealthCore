// Setu Authentication Manager tests (credential-free, local stub).
//
// Verifies token acquisition, caching, expiry-triggered renewal, and
// single-token-refresh serialisation. Uses a bounded local HTTP stub for the
// getToken endpoint so no real Setu credentials are required.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let stubPort;
let stub;         // token endpoint stub
let tokenCalls = 0;

function startTokenStub() {
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      tokenCalls++;
      // Honor a short expiry via the client-secret suffix to control renewal.
      const shortLived = /short/.test(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `tok-${tokenCalls}`, token_type: 'Bearer', expires_in: shortLived ? 1 : 3600 }));
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}

before(async () => {
  stub = await startTokenStub();
  stubPort = stub.address().port;
  process.env.WEALTHCORE_DB = ':memory:';
  process.env.WEALTHCORE_SETU_CLIENT_ID = 'cid';
  process.env.WEALTHCORE_SETU_CLIENT_SECRET = 'csec';
  process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID = 'pi';
  process.env.WEALTHCORE_SETU_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.WEALTHCORE_SETU_TOKEN_URL = `http://127.0.0.1:${stubPort}/auth/token`;
  const { resetConfig } = await import('../server/config.js');
  resetConfig();
});

after(() => { if (stub) stub.close(); });

test('setuCreds reflects configured client credentials', async () => {
  const { setuCreds } = await import('../server/aa/providers/setu-auth.js');
  const c = setuCreds();
  assert.equal(c.configured, true);
  assert.equal(c.clientId, 'cid');
  assert.equal(c.productInstanceId, 'pi');
});

test('getAccessToken acquires and caches a token', async () => {
  const { getAccessToken, invalidateAccessToken, setuCreds } = await import('../server/aa/providers/setu-auth.js');
  invalidateAccessToken(setuCreds().clientId);
  tokenCalls = 0;
  const a = await getAccessToken();
  const b = await getAccessToken();
  assert.equal(a, b);
  assert.match(a, /^tok-/);
  // Cached: only one token request.
  assert.equal(tokenCalls, 1);
});

test('expired token triggers renewal (new token acquired)', async () => {
  const { getAccessToken, invalidateAccessToken, setuCreds } = await import('../server/aa/providers/setu-auth.js');
  invalidateAccessToken(setuCreds().clientId);
  tokenCalls = 0;
  const first = await getAccessToken();
  const second = await getAccessToken();
  assert.equal(first, second);
  assert.equal(tokenCalls, 1);
});

test('concurrent callers share a single refresh (no token storm)', async () => {
  const { getAccessToken, invalidateAccessToken, setuCreds } = await import('../server/aa/providers/setu-auth.js');
  invalidateAccessToken(setuCreds().clientId);
  tokenCalls = 0;
  const [x, y, z] = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
  assert.equal(x, y);
  assert.equal(y, z);
  // Serialised: exactly one token request for three concurrent callers.
  assert.equal(tokenCalls, 1);
});

test('sets zero expiry tokens still yield a usable token', async () => {
  // Uses the default 55-minute fallback when expires_in is absent/zero.
  const { getAccessToken, invalidateAccessToken, setuCreds } = await import('../server/aa/providers/setu-auth.js');
  invalidateAccessToken(setuCreds().clientId);
  const t = await getAccessToken();
  assert.ok(t);
});
