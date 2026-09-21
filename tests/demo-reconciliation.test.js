// Demo reconciliation tests.
//
// Verifies the existing WealthCore reconciliation + snapshot + net-worth
// engines operate consistently over the loaded demo profile:
//   * reconciliation runs classify every account with a real status;
//   * stored demo balances reconcile with fixture-derived closing balances;
//   * in-DB cash flows reconcile with fixture flows (opening + credits −
//     debits = stored closing balance);
//   * snapshots equal the engine output (no fabricated totals);
//   * portfolio ↔ account totals reconcile (net worth arithmetic).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { loadDemoProfile } = await import('../server/lib/demo.js');
const { runAllReconciliations, reconciliationForAccount, STATUSES } = (await import('../server/lib/reconciliation.js')).default;
const { computeNetWorth } = await import('../server/lib/networth.js');
const { computePortfolio } = await import('../server/lib/portfolio.js');
const { buildDemoFinancialData, demoCashFlows } = await import('../server/aa/fixtures/demo-data.js');

const db = getDb();
let userId;

before(async () => {
  userId = db.prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .run('demo-recon@wealthcore.local', 'Recon User', 'hash', 'salt').lastInsertRowid;
  await loadDemoProfile(db, userId);
});

test('reconciliation engine runs across the demo profile with valid statuses', () => {
  const { results, summary } = runAllReconciliations(db, userId);
  const accounts = db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id=?').get(userId).c;
  assert.equal(results.length, accounts);
  assert.equal(summary.total, accounts);
  for (const r of results) {
    assert.ok(STATUSES.includes(r.status), `valid status: ${r.status}`);
    assert.equal(r.duplicateCount, 0, 'demo load must not introduce duplicates');
  }
  // AA-imported demo rows carry no provider-reported source balance yet.
  assert.equal(summary.matched + summary.difference + summary.duplicate + summary.missingSource + summary.review, summary.total);
});

test('stored balances reconcile with fixture closing balances (per account)', () => {
  const env = buildDemoFinancialData();
  for (const raw of env.accounts) {
    const rec = reconciliationForAccount(db, userId,
      db.prepare('SELECT id FROM accounts WHERE user_id=? AND external_ref=?').get(userId, raw.linkRefNumber).id);
    const expected = raw.isLiability ? Math.abs(raw.currentBalanceMinor) : raw.currentBalanceMinor;
    assert.equal(rec.localBalanceMinor, expected, `${raw.linkRefNumber} local balance == derived closing`);
  }
});

test('in-database cash flows reconcile: opening + credits − debits = stored balance', () => {
  const env = buildDemoFinancialData();
  const flows = demoCashFlows(env.transactions);
  for (const raw of env.accounts) {
    const row = db.prepare('SELECT id, balance_minor, is_liability FROM accounts WHERE user_id=? AND external_ref=?').get(userId, raw.linkRefNumber);
    const dbCredits = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND account_id=? AND direction='in' AND status='active'`).get(userId, row.id).s;
    const dbDebits = db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND account_id=? AND direction='out' AND status='active'`).get(userId, row.id).s;
    const f = flows.get(raw.linkRefNumber) || { credits: 0, debits: 0 };
    assert.equal(dbCredits, f.credits, `${raw.linkRefNumber} credits in DB reconcile with fixture`);
    assert.equal(dbDebits, f.debits, `${raw.linkRefNumber} debits in DB reconcile with fixture`);
    const closing = raw.openingBalanceMinor + dbCredits - dbDebits;
    const expected = raw.isLiability ? Math.abs(closing) : closing;
    assert.equal(row.balance_minor, expected, `${raw.linkRefNumber}: opening + credits − debits = stored balance`);
  }
});

test('snapshot recorded by demo load equals the engine output (derived, not hard-coded)', () => {
  const snap = db.prepare('SELECT * FROM snapshots WHERE user_id=? AND is_demo=1 ORDER BY id DESC LIMIT 1').get(userId);
  assert.ok(snap, 'demo load records a snapshot');
  const nw = computeNetWorth(db, userId);
  assert.equal(Number(snap.total_assets_minor), nw.totalAssetsMinor);
  assert.equal(Number(snap.total_liabilities_minor), nw.totalLiabilitiesMinor);
  assert.equal(Number(snap.net_worth_minor), nw.netWorthMinor);
  assert.equal(nw.netWorthMinor, nw.totalAssetsMinor - nw.totalLiabilitiesMinor, 'net worth identity holds');
});

test('portfolio total reconciles with account-level net worth', () => {
  const nw = computeNetWorth(db, userId);
  const pf = computePortfolio(db, userId);
  const cashAssets = db.prepare(`SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE user_id=? AND is_liability=0`).get(userId).s;
  assert.equal(nw.totalAssetsMinor, cashAssets + pf.totalValueMinor, 'cash + portfolio = total assets');
  assert.equal(pf.validation.invariantHolds, true);
  assert.equal(nw.holdingCount, pf.holdingsCount);
  assert.equal(nw.holdingCount, 12);
});

test('reconciliation surfaces demo accounts distinctly as DEMO provenance', () => {
  const rows = db.prepare(`SELECT external_ref, source, provider FROM accounts WHERE user_id=? AND provider='demo'`).all(userId);
  assert.equal(rows.length, 13);
  assert.ok(rows.every((r) => r.external_ref.startsWith('DEMO-') && r.source === 'DEMO'));
});

test('no demo transaction duplicates are reported by the reconciliation engine', () => {
  const dups = db.prepare(`
    SELECT dedup_key, COUNT(*) n FROM transactions
    WHERE user_id=? AND status='active' AND source_txn_id LIKE 'DEMO-%'
    GROUP BY dedup_key HAVING n > 1`).all(userId);
  assert.equal(dups.length, 0);
  const { summary } = runAllReconciliations(db, userId);
  assert.equal(summary.duplicate, 0);
});
