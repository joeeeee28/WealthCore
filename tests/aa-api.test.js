// AA end-to-end HTTP flow: connect → approve → sync → idempotent re-sync →
// net worth / transactions / holdings updated from the Mock provider.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { app } = await import('../server/index.js');

let server;
let base;
let token;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(() => { server.close(); });

async function req(method, path, body, tok) {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = res.status === 204 ? null : await res.json();
  return { status: res.status, json };
}

test('aa/providers lists mock first and marks real providers not-configured', async () => {
  const setup = await req('POST', '/auth/setup', { email: 'aa@wealthcore.local', name: 'AA', password: 'wealthcore-aa' });
  token = setup.json.token;
  const { status, json } = await req('GET', '/aa/providers', null, token);
  assert.equal(status, 200);
  assert.equal(json.providers[0].name, 'mock');
  assert.equal(json.providers[0].requiresCredentials, false);
  assert.equal(json.providers[0].status.mode, 'MOCK');
  const finvu = json.providers.find((p) => p.name === 'finvu');
  assert.equal(finvu.requiresCredentials, true);
  assert.match(finvu.status.detail, /READY_FOR_CONFIGURATION/);
});

test('aa/workflow exposes consent and data state machines', async () => {
  const { status, json } = await req('GET', '/aa/workflow', null, token);
  assert.equal(status, 200);
  assert.ok(json.consent.pending.includes('approved'));
  assert.ok(json.data.data_requested.includes('data_ready'));
});

test('full mock AA lifecycle: connect → approve → sync → idempotent re-sync', async () => {
  // 1. Connect via Mock AA.
  const connect = await req('POST', '/aa/connect', { provider: 'mock', fiType: 'DEPOSIT', fiTypes: ['DEPOSIT', 'EQUITIES', 'MUTUAL_FUNDS', 'INSURANCE_POLICIES'], purpose: 'Personal financial management', customerHandle: 'demo@wealthcore' }, token);
  assert.equal(connect.status, 200);
  const consentId = connect.json.consent.id;
  assert.equal(connect.json.consent.status, 'pending');
  assert.equal(connect.json.consent.provider, 'mock');

  // 2. Approve consent (required before sync).
  const approve = await req('POST', `/aa/consent/${consentId}/approve`, {}, token);
  assert.equal(approve.status, 200);
  assert.equal(approve.json.consent.status, 'approved');

  // 3. Sync financial data.
  const sync = await req('POST', '/aa/sync', { consentId }, token);
  assert.equal(sync.status, 200);
  assert.equal(sync.json.ok, true);
  assert.ok(sync.json.summary.accountsCreated >= 1);
  assert.ok(sync.json.summary.transactionsCreated >= 1);

  // 4. Idempotency: re-sync must not duplicate.
  const resync = await req('POST', '/aa/sync', { consentId }, token);
  assert.equal(resync.status, 200);
  assert.equal(resync.json.summary.accountsCreated, 0);
  assert.equal(resync.json.summary.transactionsDuplicates > 0 || resync.json.summary.transactionsCreated === 0, true);

  // 5. Dashboard reflects imported data (assets/liabilities from mock).
  const dash = await req('GET', '/dashboard', null, token);
  assert.equal(dash.status, 200);
  assert.ok(dash.json.netWorth.totalAssetsMinor > 0);

  // 6. Holdings imported (investments).
  const portfolio = await req('GET', '/portfolio', null, token);
  assert.ok(portfolio.json.holdingsCount >= 1);

  // 7. Provenance present on imported transactions.
  const txns = await req('GET', '/transactions?limit=100', null, token);
  const aaTx = txns.json.transactions.find((t) => t.source === 'aa');
  assert.ok(aaTx);
  assert.ok(aaTx.source_txn_id);
});

test('sync before approval is rejected', async () => {
  const connect = await req('POST', '/aa/connect', { provider: 'mock', fiType: 'DEPOSIT', purpose: 'Test' }, token);
  const sync = await req('POST', '/aa/sync', { consentId: connect.json.consent.id }, token);
  assert.equal(sync.status, 400);
  assert.equal(sync.json.error.code, 'CONSENT_REQUIRES_APPROVAL');
});

test('unsupported/unknown provider surfaces a safe not-configured error', async () => {
  const connect = await req('POST', '/aa/connect', { provider: 'finvu', fiType: 'DEPOSIT', purpose: 'Test' }, token);
  assert.equal(connect.status, 400);
  assert.equal(connect.json.error.code, 'PROVIDER_NOT_CONFIGURED');
});
