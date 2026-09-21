// Demo load / refresh / reset seeding tests.
//
// Verifies: full demo profile load through the AA sync pipeline, user
// isolation (one user's demo data is never visible to another), idempotent
// load & refresh (zero duplicate records), and complete user-scoped reset.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { loadDemoProfile, refreshDemoProfile, resetDemoProfile, demoStatus } = await import('../server/lib/demo.js');
const { DEMO_TRANSACTION_COUNT } = await import('../server/aa/fixtures/demo-data.js');

const db = getDb();
let u1;
let u2;

function createUser(email) {
  return db.prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .run(email, 'Test User', 'hash', 'salt').lastInsertRowid;
}

function demoCounts(userId) {
  return {
    accounts: db.prepare(`SELECT COUNT(*) c FROM accounts WHERE user_id=? AND provider='demo'`).get(userId).c,
    transactions: db.prepare(`SELECT COUNT(*) c FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-TXN-%'`).get(userId).c,
    securities: db.prepare(`SELECT COUNT(*) c FROM securities WHERE user_id=? AND provider='demo'`).get(userId).c,
    holdings: db.prepare(`SELECT COUNT(*) c FROM holdings h JOIN securities s ON s.id=h.security_id WHERE h.user_id=? AND s.provider='demo'`).get(userId).c,
    goals: db.prepare(`SELECT COUNT(*) c FROM goals WHERE user_id=? AND is_demo=1`).get(userId).c,
    budgets: db.prepare(`SELECT COUNT(*) c FROM budgets WHERE user_id=? AND is_demo=1`).get(userId).c,
  };
}

before(async () => {
  u1 = createUser('demo-seed-1@wealthcore.local');
  u2 = createUser('demo-seed-2@wealthcore.local');
});

test('demo load persists the full deterministic wealth profile via the AA pipeline', async () => {
  const r = await loadDemoProfile(db, u1);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'demo');
  assert.equal(r.mode, 'DEMO');
  assert.equal(r.synthetic, true);
  assert.match(r.notice, /DEMO DATA/);

  assert.equal(r.summary.totalAccounts, 7);
  assert.equal(r.summary.accountsCreated, 7);
  assert.equal(r.summary.totalTransactions, DEMO_TRANSACTION_COUNT);
  assert.equal(r.summary.transactionsCreated, DEMO_TRANSACTION_COUNT);
  assert.equal(r.summary.totalHoldings, 12);
  assert.equal(r.summary.holdingsCreated, 12);
  assert.equal(r.summary.extrasCreated, 16, '3 retirement + 3 insurance + 6 goals + 4 budgets');
  assert.ok(r.summary.sessionId && r.summary.consentId, 'sync produced provenance ids');

  const c = demoCounts(u1);
  assert.equal(c.accounts, 13, '7 AA accounts + 3 retirement + 3 insurance');
  assert.equal(c.transactions, 180);
  assert.equal(c.securities, 12);
  assert.equal(c.holdings, 12);
  assert.equal(c.goals, 6);
  assert.equal(c.budgets, 4);
});

test('demo records are clearly labelled synthetic in the database', () => {
  const acc = db.prepare(`SELECT source, provider, is_demo FROM accounts WHERE user_id=? AND external_ref='DEMO-LINK-SAV-0001'`).get(u1);
  assert.deepEqual(acc, { source: 'DEMO', provider: 'demo', is_demo: 1 });
  const tx = db.prepare(`SELECT source, provider_ref, is_demo, source_txn_id FROM transactions WHERE user_id=? AND source_txn_id='DEMO-TXN-0001'`).get(u1);
  assert.equal(tx.source, 'DEMO');
  assert.equal(tx.provider_ref, 'DEMO-TXN-0001');
  assert.equal(tx.is_demo, 1);
  const sec = db.prepare(`SELECT provider, is_demo, price_status FROM securities WHERE user_id=? AND provider='demo'`).all(u1);
  assert.equal(sec.length, 12);
  assert.ok(sec.every((s) => s.is_demo === 1));
  const goals = db.prepare('SELECT name, is_demo FROM goals WHERE user_id=? AND is_demo=1').all(u1);
  assert.equal(goals.length, 6);
  assert.ok(goals.every((g) => g.name.startsWith('Demo \u25B8 ')), 'demo goals carry a visible Demo ▸ prefix');
});

test('user isolation: another user sees none of the demo data', () => {
  const c = demoCounts(u2);
  assert.deepEqual(c, { accounts: 0, transactions: 0, securities: 0, holdings: 0, goals: 0, budgets: 0 });
  const st = demoStatus(db, u2);
  assert.equal(st.loaded, false);
  const cross = db.prepare(`SELECT COUNT(*) c FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-%'`).get(u2).c;
  assert.equal(cross, 0);
});

test('demo load is idempotent — a second load creates zero duplicates', async () => {
  const before = demoCounts(u1);
  const r = await loadDemoProfile(db, u1);
  assert.equal(r.summary.accountsCreated, 0);
  assert.equal(r.summary.transactionsCreated, 0);
  assert.equal(r.summary.holdingsCreated, 0);
  assert.equal(r.summary.transactionsDuplicates, DEMO_TRANSACTION_COUNT);
  assert.equal(r.summary.holdingsDuplicates, 12);
  assert.equal(r.summary.extrasCreated, 0);
  const after = demoCounts(u1);
  assert.deepEqual(after, before);
  const dupKeys = db.prepare(`SELECT dedup_key, COUNT(*) n FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-%' GROUP BY dedup_key HAVING n>1`).all(u1);
  assert.equal(dupKeys.length, 0, 'no duplicate demo transaction keys');
});

test('demo refresh is idempotent — counts stay flat, duplicates reported', async () => {
  const before = demoCounts(u1);
  const r = await refreshDemoProfile(db, u1);
  assert.equal(r.reason, 'refresh');
  assert.equal(r.summary.transactionsCreated, 0);
  assert.equal(r.summary.transactionsDuplicates, DEMO_TRANSACTION_COUNT);
  assert.deepEqual(demoCounts(u1), before);
});

test('deterministic reload: reset then load produces identical data', async () => {
  const sumBefore = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s, COUNT(*) c FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-%'`).get(u1);
  const accBefore = db.prepare(`SELECT external_ref, balance_minor FROM accounts WHERE user_id=? AND provider='demo' ORDER BY external_ref`).all(u1);

  resetDemoProfile(db, u1);
  await loadDemoProfile(db, u1);

  const sumAfter = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s, COUNT(*) c FROM transactions WHERE user_id=? AND source_txn_id LIKE 'DEMO-%'`).get(u1);
  const accAfter = db.prepare(`SELECT external_ref, balance_minor FROM accounts WHERE user_id=? AND provider='demo' ORDER BY external_ref`).all(u1);
  // Totals must match exactly after reload (fixture determinism is also
  // exhaustively covered in demo-normalization tests).
  assert.equal(sumAfter.c, sumBefore.c);
  assert.equal(sumAfter.s, sumBefore.s);
  assert.deepEqual(accAfter, accBefore);
});

test('demo reset removes ALL demo rows for the calling user and keeps other users intact', async () => {
  await loadDemoProfile(db, u2);
  assert.equal(demoCounts(u2).transactions, DEMO_TRANSACTION_COUNT);

  const mine = demoCounts(u1);
  assert.ok(mine.transactions > 0);
  const res = resetDemoProfile(db, u1);
  assert.equal(res.ok, true);

  assert.deepEqual(demoCounts(u1), { accounts: 0, transactions: 0, securities: 0, holdings: 0, goals: 0, budgets: 0 });
  // Everything demo-flavoured for u1 is gone (including snapshots/extras).
  assert.equal(db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id=? AND (is_demo=1 OR external_ref LIKE \'DEMO-%\')').get(u1).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM snapshots WHERE user_id=? AND is_demo=1').get(u1).c, 0);

  // u2's demo data is completely untouched by u1's reset.
  assert.equal(demoCounts(u2).transactions, DEMO_TRANSACTION_COUNT);
  assert.equal(demoCounts(u2).accounts, 13);

  // And u1 can load cleanly again (idempotent lifecycle).
  const again = await loadDemoProfile(db, u1);
  assert.equal(again.summary.transactionsCreated, DEMO_TRANSACTION_COUNT);
});

test('demo status reports loaded state, counts and the synthetic notice', async () => {
  const st = demoStatus(db, u1);
  assert.equal(st.loaded, true);
  assert.equal(st.synthetic, true);
  assert.match(st.notice, /synthetic/i);
  assert.ok(st.lastLoadedAt);
  assert.equal(st.counts.transactions, DEMO_TRANSACTION_COUNT);
  assert.equal(st.counts.accounts, 13);
  assert.equal(st.environment.value, 'DEMO');
  assert.equal(st.environment.synthetic, true);
});
