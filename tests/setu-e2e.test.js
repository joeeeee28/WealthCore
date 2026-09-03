// Setu sandbox end-to-end via a bounded LOCAL Setu simulator.
//
// IMPORTANT: This does NOT hit the real Setu sandbox — there are no Setu
// credentials in this environment. Instead it spins up a minimal HTTP server that
// mimics the documented Setu v2 endpoints so the adapter's request/response
// handling (and the full WealthCore sync) is verified against the correct
// contract shape. It never claims a real bank was connected.
//
// A REAL Setu sandbox interaction requires client credentials
// (WEALTHCORE_SETU_CLIENT_ID + WEALTHCORE_SETU_CLIENT_SECRET +
// WEALTHCORE_SETU_PRODUCT_INSTANCE_ID); that is a separate, credential-gated step
// reported as BLOCKED — SETU CREDENTIALS / SANDBOX ACCESS REQUIRED.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.AA_PROVIDER = 'setu';
process.env.AA_ENVIRONMENT = 'sandbox';
process.env.SETU_ENVIRONMENT = 'sandbox';

let sim;         // local Setu simulator
let simPort;
let server;      // WealthCore
let base;
let token;

const SETU_FI = {
  id: 'sim-session-1',
  status: 'COMPLETED',
  format: 'json',
  consentId: 'sim-consent-1',
  dataRange: { from: '2026-01-01T00:00:00Z', to: '2026-08-31T00:00:00Z' },
  fips: [{ fipID: 'Setu-FIP', accounts: [{ linkRefNumber: 'sim-link-1', maskedAccNumber: 'XXXXXX1111', status: 'DELIVERED', data: { account: { linkedAccRef: 'sim-link-1', type: 'deposit', summary: { currentBalance: '250000.00', currency: 'INR', type: 'SAVINGS', balanceDateTime: '2026-08-31T00:00:00Z' }, transactions: { transaction: [
    { txnId: 'SIM-TXN-1', amount: '50000.00', type: 'CREDIT', narration: 'Salary', transactionDateTime: '2026-08-01T09:00:00Z' },
    { txnId: 'SIM-TXN-2', amount: '1200.00', type: 'DEBIT', narration: 'BigBasket', transactionDateTime: '2026-08-03T12:00:00Z' },
  ] } } } }] }],
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function startSetuSimulator() {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // Token endpoint (current official Setu AA "Get Token"): POST /users/login,
      // header `client: bridge`, JSON body { clientID, grant_type:"client_credentials",
      // secret }; the bearer token is returned as `access_token`.
      if (req.method === 'POST' && url.pathname === '/users/login') {
        const tokenReq = body ? JSON.parse(body) : {};
        const wellFormed =
          (req.headers['content-type'] || '').includes('application/json') &&
          (req.headers['client'] || '') === 'bridge' &&
          tokenReq.clientID && tokenReq.secret && tokenReq.grant_type === 'client_credentials';
        if (!wellFormed) {
          return json(res, 400, { errorCode: 'InvalidRequest', errorMsg: 'invalid token request' });
        }
        return json(res, 200, { access_token: 'sim-access-token', refresh_token: 'sim-refresh-token' });
      }
      // All other API calls must carry Authorization: Bearer <access_token> + x-product-instance-id.
      const auth = req.headers['authorization'] || '';
      const pi = req.headers['x-product-instance-id'];
      if (auth !== 'Bearer sim-access-token' || pi !== 'sim-pi') {
        return json(res, 401, { errorMsg: 'unauthorized', errorCode: 'InvalidRequest' });
      }
      if (req.method === 'POST' && url.pathname === '/v2/consents') {
        const data = body ? JSON.parse(body) : {};
        return json(res, 200, {
          id: 'sim-consent-1', url: 'http://' + '127.0.0.1' + ':' + simPort + '/webview/1', status: 'PENDING',
          detail: { consentStart: '2026-08-01T00:00:00Z', consentExpiry: '2026-12-31T00:00:00Z', fiTypes: detailFiTypes(data), fetchType: 'PERIODIC', purpose: { text: 'Personal financial management' }, vua: data.vua, dataRange: data.dataRange },
        });
      }
      if (req.method === 'POST' && url.pathname === '/sessions') {
        const data = body ? JSON.parse(body) : {};
        return json(res, 200, { id: 'sim-session-1', consentId: data.consentId, status: 'PENDING' });
      }
      if (req.method === 'GET' && /^\/sessions\//.test(url.pathname)) {
        return json(res, 200, SETU_FI);
      }
      if (req.method === 'GET' && /^\/consents\/sim-consent-1/.test(url.pathname)) {
        return json(res, 200, { id: 'sim-consent-1', url: 'http://x/webview/1', status: 'ACTIVE', detail: { vua: 'demo@setu' } });
      }
      if (req.method === 'POST' && url.pathname === '/v2/consents/sim-consent-1/revoke') {
        return json(res, 200, { id: 'sim-consent-1', status: 'REVOKED' });
      }
      return json(res, 404, { errorMsg: 'not found', errorCode: 'InvalidRequest' });
    });
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}

function detailFiTypes(data) { return data.fiTypes || ['DEPOSIT']; }

before(async () => {
  sim = await startSetuSimulator();
  simPort = sim.address().port;
  // Current official Setu auth model (client credentials).
  process.env.WEALTHCORE_SETU_CLIENT_ID = 'sim-client-id';
  process.env.WEALTHCORE_SETU_CLIENT_SECRET = 'sim-client-secret';
  process.env.WEALTHCORE_SETU_PRODUCT_INSTANCE_ID = 'sim-pi';
  process.env.WEALTHCORE_SETU_BASE_URL = `http://127.0.0.1:${simPort}`;
  process.env.WEALTHCORE_SETU_TOKEN_URL = `http://127.0.0.1:${simPort}/users/login`;
  // Reset the cached config so the server (imported next) picks up the env.
  const { resetConfig } = await import('../server/config.js');
  resetConfig();

  const { app } = await import('../server/index.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  // The in-memory DB singleton is shared across all test files in this process,
  // so wipe existing data before setup to honour the single-user constraint.
  const { getDb } = await import('../server/db.js');
  const db = getDb();
  db.exec(`DELETE FROM webhook_notifications; DELETE FROM aa_sessions; DELETE FROM sync_runs; DELETE FROM consents; DELETE FROM transactions; DELETE FROM holdings; DELETE FROM securities; DELETE FROM budgets; DELETE FROM goals; DELETE FROM notifications; DELETE FROM reconciliation_runs; DELETE FROM reconciliation_items; DELETE FROM accounts; DELETE FROM categories; DELETE FROM users;`);

  const setup = await fetch(base + '/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Setu E2E', email: 'setu@wealthcore.local', password: 'wealthcore-setu' }) }).then((r) => r.json());
  token = setup.token;
});

after(() => { if (server) server.close(); if (sim) sim.close(); });

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = res.status === 204 ? null : await res.json();
  return { status: res.status, json };
}

test('config reports Setu provider with Setu credentials in sandbox', async () => {
  const { status, json } = await req('GET', '/aa/providers');
  assert.equal(status, 200);
  const setu = json.providers.find((p) => p.name === 'setu');
  assert.equal(setu.configured, true);
  assert.equal(setu.status.mode, 'sandbox');
  assert.equal(setu.requiresCredentials, false);
});

test('full Setu sandbox flow: connect-setu → sync → accounts/transactions persisted', async () => {
  // 1. Create a real Setu consent request (via the local simulator).
  const connect = await req('POST', '/aa/connect-setu', { fiType: 'DEPOSIT', fiTypes: ['DEPOSIT'], purpose: 'Personal financial management', customerHandle: '9999999999@setu' });
  assert.equal(connect.status, 200);
  assert.equal(connect.json.provider, 'setu');
  assert.ok(connect.json.redirectUrl);
  const consentId = connect.json.consent.id;
  assert.equal(connect.json.consent.external_ref, 'sim-consent-1');

  // 2. Approve locally (simulator returns ACTIVE).
  const approve = await req('POST', `/aa/consent/${consentId}/approve`, {});
  assert.equal(approve.status, 200);
  assert.equal(approve.json.consent.status, 'approved');

  // 3. Sync — the adapter creates a data session and fetches FI from the simulator.
  const sync = await req('POST', '/aa/sync', { consentId });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.ok, true);
  assert.equal(sync.json.summary.provider, 'setu');
  assert.ok(sync.json.summary.accountsCreated >= 1, `expected accounts, got ${sync.json.summary.accountsCreated}`);
  assert.ok(sync.json.summary.transactionsCreated >= 1, `expected transactions, got ${sync.json.summary.transactionsCreated}`);
  assert.equal(sync.json.summary.transactionsDuplicates, 0);

  // 4. Idempotent re-sync.
  const resync = await req('POST', '/aa/sync', { consentId });
  assert.equal(resync.status, 200);
  assert.equal(resync.json.summary.accountsCreated, 0);
  assert.equal(resync.json.summary.transactionsCreated, 0);

  // 5. Dashboard reflects Setu sandbox data.
  const dash = await req('GET', '/dashboard');
  assert.ok(dash.json.netWorth.totalAssetsMinor > 0);
  assert.equal(dash.json.demoCount, 1); // labelled demo/sandbox
});

test('Consent revocation via a REAL-format Setu webhook updates consent state', async () => {
  // Setu's current AA consent notification contract: status under data.status.
  const body = {
    type: 'CONSENT_STATUS_UPDATE',
    timestamp: new Date().toISOString(),
    success: true,
    consentId: 'sim-consent-1',
    notificationId: 'sim-notif-revoke-1',
    data: { status: 'REVOKED', detail: {} },
  };
  const res = await fetch(base + '/aa/webhook/setu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);

  // Consent row should now be revoked.
  const consents = await req('GET', '/aa/consents');
  const row = consents.json.find((c) => c.external_ref === 'sim-consent-1');
  assert.equal(row.status, 'revoked');

  // Idempotency: replaying the same notification id must not error or mutate.
  const replay = await fetch(base + '/aa/webhook/setu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(replay.status, 200);
  const rj = await replay.json();
  assert.equal(rj.ok, true);
  assert.equal(rj.idempotent, true);

  // The notification is recorded exactly once.
  const { getDb } = await import('../server/db.js');
  const db = getDb();
  const seen = db.prepare("SELECT COUNT(*) c FROM webhook_notifications WHERE provider='setu' AND notification_id='sim-notif-revoke-1'").get();
  assert.equal(seen.c, 1);
});
