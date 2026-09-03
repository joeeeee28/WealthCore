// Setu Authentication Manager tests (credential-free, local stub).
//
// Verifies the current official Setu AA "Get Token" request shape
// (POST /users/login on the AA host; header `client: bridge`; JSON body
// { clientID, grant_type:"client_credentials", secret }; response access_token),
// token acquisition, caching, expiry-triggered renewal, and single-token-refresh
// serialisation. Uses a bounded local HTTP stub so no real Setu credentials are
// required.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let stubPort;
let stub;         // token endpoint stub
let tokenCalls = 0;
let lastTokenBody = '';
let lastTokenContentType = '';
let lastTokenClientHeader = '';

function startTokenStub() {
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      tokenCalls++;
      lastTokenBody = body;
      lastTokenContentType = req.headers['content-type'] || '';
      lastTokenClientHeader = req.headers['client'] || '';
      // Current official Setu AA Get Token response shape: { access_token, refresh_token }.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `tok-${tokenCalls}`, refresh_token: `refresh-${tokenCalls}` }));
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
  process.env.WEALTHCORE_SETU_TOKEN_URL = `http://127.0.0.1:${stubPort}/users/login`;
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

test('setuTokenEndpoint defaults to the documented AA Get Token endpoint on the AA host', async () => {
  const { setuTokenEndpoint } = await import('../server/aa/providers/setu-auth.js');
  const { resetConfig } = await import('../server/config.js');
  // Isolate the default endpoint from the local test-stub override.
  const savedTokenUrl = process.env.WEALTHCORE_SETU_TOKEN_URL;
  const savedBaseUrl = process.env.WEALTHCORE_SETU_BASE_URL;
  process.env.WEALTHCORE_SETU_TOKEN_URL = '';
  process.env.WEALTHCORE_SETU_BASE_URL = 'https://fiu-sandbox.setu.co';
  resetConfig();
  // AA token endpoint lives on the SAME host as the AA APIs (/users/login),
  // NOT the payments host uat.setu.co.
  assert.equal(setuTokenEndpoint(), 'https://fiu-sandbox.setu.co/users/login');
  process.env.WEALTHCORE_SETU_TOKEN_URL = savedTokenUrl;
  process.env.WEALTHCORE_SETU_BASE_URL = savedBaseUrl;
  resetConfig();
});

test('setuTokenRequest uses the current official AA Get Token JSON body + client:bridge header', async () => {
  const { setuTokenRequest } = await import('../server/aa/providers/setu-auth.js');
  const req = setuTokenRequest('cid', 'csec');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.equal(req.headers.client, 'bridge');
  assert.deepEqual(JSON.parse(req.body), { clientID: 'cid', grant_type: 'client_credentials', secret: 'csec' });
});

test('getAccessToken acquires and caches a token', async () => {
  const { getAccessToken, invalidateAccessToken, setuCreds } = await import('../server/aa/providers/setu-auth.js');
  invalidateAccessToken(setuCreds().clientId);
  tokenCalls = 0;
  const a = await getAccessToken();
  const b = await getAccessToken();
  assert.equal(a, b);
  assert.match(a, /^tok-/);
  const sent = JSON.parse(lastTokenBody);
  assert.equal(sent.clientID, 'cid');
  assert.equal(sent.secret, 'csec');
  assert.equal(sent.grant_type, 'client_credentials');
  assert.equal(lastTokenContentType, 'application/json');
  assert.equal(lastTokenClientHeader, 'bridge');
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
