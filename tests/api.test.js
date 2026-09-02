// End-to-end API integration tests against a real HTTP listener + SQLite.

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

test('config reports setup required initially', async () => {
  const { status, json } = await req('GET', '/config');
  assert.equal(status, 200);
  assert.equal(json.setupRequired, true);
  assert.equal(json.name, 'WealthCore');
});

test('unauthenticated dashboard returns 401', async () => {
  const { status } = await req('GET', '/dashboard');
  assert.equal(status, 401);
});

test('setup, login and dashboard flow', async () => {
  const setup = await req('POST', '/auth/setup', { email: 'demo@wealthcore.local', name: 'Demo', password: 'wealthcore-demo' });
  assert.equal(setup.status, 200);
  token = setup.json.token;
  assert.ok(token);

  const me = await req('GET', '/auth/me', null, token);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'demo@wealthcore.local');

  const dash = await req('GET', '/dashboard', null, token);
  assert.equal(dash.status, 200);
  assert.equal(dash.json.netWorth.totalAssetsMinor, 0);
});

test('accounts and transactions CRUD with validation and dedup', async () => {
  const acct = await req('POST', '/accounts', { name: 'Savings', type: 'savings', balanceMinor: 5000000 }, token);
  assert.equal(acct.status, 200);
  const acctId = acct.json.account.id;

  const tx = await req('POST', '/transactions', { accountId: acctId, date: '2026-08-01', amountMinor: 150000, direction: 'out', merchant: 'BigBasket Groceries', currency: 'INR' }, token);
  assert.equal(tx.status, 200);
  assert.equal(tx.json.transaction.category_name, 'Groceries');

  // Duplicate rejected
  const dup = await req('POST', '/transactions', { accountId: acctId, date: '2026-08-01', amountMinor: 150000, direction: 'out', merchant: 'BigBasket Groceries', currency: 'INR' }, token);
  assert.equal(dup.status, 400);
  assert.equal(dup.json.error.code, 'DUPLICATE');

  // Invalid amount rejected
  const bad = await req('POST', '/transactions', { accountId: acctId, date: '2026-08-01', amountMinor: -5, direction: 'out', merchant: 'X', currency: 'INR' }, token);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_TRANSACTION');
});

test('transaction list supports filters without ambiguous columns', async () => {
  const acct = await req('POST', '/accounts', { name: 'List Acct', type: 'savings', balanceMinor: 100000 }, token);
  const id = acct.json.account.id;
  await req('POST', '/transactions', { accountId: id, date: '2026-08-03', amountMinor: 5000, direction: 'out', merchant: 'Utility Bill', currency: 'INR' }, token);
  const list = await req('GET', '/transactions?month=2026-08&limit=10', null, token);
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.transactions));
  const search = await req('GET', '/transactions?month=2026-08&search=Utility', null, token);
  assert.equal(search.status, 200);
  assert.ok(search.json.transactions.length >= 1);
});

test('deterministic calculator endpoints', async () => {
  const emi = await req('POST', '/calculators/emi', { principal: 500000, annualRatePercent: 8.5, months: 240 }, token);
  assert.equal(emi.status, 200);
  assert.ok(Math.abs(emi.json.emi - 4339.1162) < 0.01);

  const sip = await req('POST', '/calculators/sip', { monthlyInvestment: 10000, annualRatePercent: 12, months: 12 }, token);
  assert.equal(sip.status, 200);
  assert.ok(Math.abs(sip.json.futureValue - 128093.28) < 0.01);
});

test('AI answers from real data', async () => {
  const acct = await req('POST', '/accounts', { name: 'Salary Acct', type: 'savings', balanceMinor: 40000000 }, token);
  const acctId = acct.json.account.id;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await req('POST', '/transactions', { accountId: acctId, date: `${ym}-10`, amountMinor: 3000000, direction: 'out', merchant: 'Food Mart', currency: 'INR' }, token);

  const ai = await req('POST', '/ai/message', { message: 'How much did I spend this month?' }, token);
  assert.equal(ai.status, 200);
  assert.match(ai.json.answer, /₹/);
  assert.deepEqual(ai.json.toolCalls, ['get_monthly_expenses']);
});

test('AA integration honestly reports READY_FOR_CONFIGURATION', async () => {
  const status = await req('GET', '/aa/status', null, token);
  assert.equal(status.status, 200);
  assert.equal(status.json.integration, 'READY_FOR_CONFIGURATION');
  assert.match(status.json.status, /credentials required/i);
});

test('Setu consent-return route is public and returns an informational page', async () => {
  const res = await fetch(base + '/aa/setu/consent/return?request_id=abc123', { method: 'GET' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Consent received/i);
  assert.match(html, /return to WealthCore/i);
  // No secret/token in the page, and it must not require auth (no bearer header sent).
  assert.ok(!/Authorization|Bearer|token:/.test(html));
});

test('export produces JSON and CSV data', async () => {
  const jsonExp = await req('GET', '/export.json', null, token);
  assert.equal(jsonExp.status, 200);
  assert.ok(Array.isArray(jsonExp.json.accounts));

  const csvRes = await fetch(base + '/export.csv', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(csvRes.status, 200);
  const csv = await csvRes.text();
  assert.match(csv, /amount_minor/);
});

test('app lock blocks data routes until unlocked', async () => {
  const pin = await req('POST', '/auth/pin', { pin: '1234' }, token);
  assert.equal(pin.status, 200);

  const lock = await req('POST', '/auth/lock', null, token);
  assert.equal(lock.status, 200);

  const blocked = await req('GET', '/dashboard', null, token);
  assert.equal(blocked.status, 423);
  assert.equal(blocked.json.error.code, 'APP_LOCKED');

  const wrongPin = await req('POST', '/auth/unlock', { pin: '0000' }, token);
  assert.equal(wrongPin.status, 401);

  const unlock = await req('POST', '/auth/unlock', { pin: '1234' }, token);
  assert.equal(unlock.status, 200);

  const ok = await req('GET', '/dashboard', null, token);
  assert.equal(ok.status, 200);
});
