// Reconciliation engine tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const {
  reconciliationForAccount, runAllReconciliations, recordReconciliationRun,
  reconciliationHistory, resolveReconciliation,
} = await import('../server/lib/reconciliation.js');

function setup() {
  const db = getDb();
  db.exec('DELETE FROM reconciliation_items; DELETE FROM reconciliation_runs; DELETE FROM transactions; DELETE FROM securities; DELETE FROM accounts; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('r','R','x','y')`).run();
  const userId = u.lastInsertRowid;
  const acct = (name, balanceMinor, source = null) => db.prepare(
    `INSERT INTO accounts (user_id, name, type, currency, balance_minor, is_liability, source, source_balance_minor, source_balance_timestamp)
     VALUES (?,?,'savings','INR',?,0, 'manual', ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`)
    .run(userId, name, balanceMinor, source, source).lastInsertRowid;
  return { db, userId, acct };
}

test('matching balances are classified MATCHED with zero difference', () => {
  const { db, userId, acct } = setup();
  const id = acct('Savings', 100000, 100000);
  const r = reconciliationForAccount(db, userId, id);
  assert.equal(r.status, 'MATCHED');
  assert.equal(r.differenceMinor, 0);
  assert.equal(r.localBalanceMinor, 100000);
});

test('differences are classified DIFFERENCE with a numeric difference, never hidden', () => {
  const { db, userId, acct } = setup();
  const id = acct('Current', 850000, 1000000);
  const r = reconciliationForAccount(db, userId, id);
  assert.equal(r.status, 'DIFFERENCE');
  assert.equal(r.differenceMinor, 150000);
});

test('no source balance -> MISSING_SOURCE_DATA', () => {
  const { db, userId, acct } = setup();
  const id = acct('Manual', 50000, null);
  const r = reconciliationForAccount(db, userId, id);
  assert.equal(r.status, 'MISSING_SOURCE_DATA');
  assert.equal(r.sourceBalanceMinor, null);
});

test('recording a reconciliation run persists history and is queryable', () => {
  const { db, userId, acct } = setup();
  const id = acct('Savings', 100000, 100000);
  const run = recordReconciliationRun(db, userId, id);
  assert.ok(run.runId > 0);
  const hist = reconciliationHistory(db, userId);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, 'MATCHED');
});

test('runAllReconciliations reports a correct summary across mixed accounts', () => {
  const { db, userId, acct } = setup();
  acct('A', 100, 100);        // matched
  acct('B', 100, 200);        // difference
  acct('C', 100, null);       // missing source
  const { results, summary } = runAllReconciliations(db, userId);
  assert.equal(results.length, 3);
  assert.equal(summary.total, 3);
  assert.equal(summary.matched, 1);
  assert.equal(summary.difference, 1);
  assert.equal(summary.missingSource, 1);
});

test('resolveReconciliation can adopt the source balance', () => {
  const { db, userId, acct } = setup();
  const id = acct('Current', 850000, 1000000);
  const r = resolveReconciliation(db, userId, id, { setBalance: true });
  assert.equal(r.status, 'MATCHED');
  const updated = db.prepare('SELECT balance_minor FROM accounts WHERE id=?').get(id);
  assert.equal(updated.balance_minor, 1000000);
});
