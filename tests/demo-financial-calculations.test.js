// Demo financial-calculation tests.
//
// NOTHING is hard-coded in the app: every derived total must flow through the
// existing WealthCore financial engines. These tests recompute expectations
// independently (from fixture inputs and SQL) and assert the engines agree:
//
//   * opening balance + credits − debits = closing balance (per account)
//   * quantity × price = market value (per holding and portfolio total)
//   * assets − liabilities = net worth
//   * debt metrics reconcile with the liability records

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { loadDemoProfile, resetDemoProfile } = await import('../server/lib/demo.js');
const { computeNetWorth, getHoldingsValuation } = await import('../server/lib/networth.js');
const { computePortfolio } = await import('../server/lib/portfolio.js');
const {
  buildDemoFinancialData, generateDemoTransactions, buildDemoAccounts, demoCashFlows, DEMO_HOLDINGS,
} = await import('../server/aa/fixtures/demo-data.js');

const db = getDb();
let userId;

before(async () => {
  userId = db.prepare('INSERT INTO users (email, name, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .run('demo-calc@wealthcore.local', 'Calc User', 'hash', 'salt').lastInsertRowid;
});

test('fixture invariant: opening + credits − debits = closing (every cash account)', () => {
  const txns = generateDemoTransactions();
  const flows = demoCashFlows(txns);
  const accounts = buildDemoAccounts(txns);
  assert.equal(accounts.length, 7);
  for (const a of accounts) {
    const f = flows.get(a.linkRefNumber) || { credits: 0, debits: 0 };
    const expected = a.openingBalanceMinor + f.credits - f.debits;
    assert.equal(a.currentBalanceMinor, expected, `${a.linkRefNumber}: ${a.openingBalanceMinor} + ${f.credits} − ${f.debits}`);
  }
  // Sanity: transacting accounts really moved; untouched accounts closed flat.
  const sav = accounts.find((a) => a.linkRefNumber === 'DEMO-LINK-SAV-0001');
  assert.notEqual(sav.currentBalanceMinor, sav.openingBalanceMinor);
  const fd = accounts.find((a) => a.linkRefNumber === 'DEMO-LINK-FD-0003');
  assert.equal(fd.currentBalanceMinor, fd.openingBalanceMinor);
});

test('holdings: quantity × price = market value (each and total)', () => {
  let total = 0;
  for (const h of DEMO_HOLDINGS) {
    const mv = Math.round(Number(h.quantity) * h.priceMinor);
    assert.ok(mv > 0);
    total += mv;
  }
  assert.equal(total, 37270000, 'deterministic portfolio market value (minor units)');
  // Cross-check with the engine valuation after loading into the DB below.
});

test('after demo load: stored balances equal the derived closing balances', async () => {
  resetDemoProfile(db, userId); // no-op safe (fresh)
  const result = await loadDemoProfile(db, userId);
  assert.equal(result.ok, true);

  const env = buildDemoFinancialData();
  for (const raw of env.accounts) {
    const row = db.prepare('SELECT balance_minor, is_liability FROM accounts WHERE user_id=? AND external_ref=?').get(userId, raw.linkRefNumber);
    assert.ok(row, raw.linkRefNumber);
    const expected = raw.isLiability ? Math.abs(raw.currentBalanceMinor) : raw.currentBalanceMinor;
    assert.equal(row.balance_minor, expected, `${raw.linkRefNumber} stored balance equals opening+credits−debits`);
  }
});

test('net worth engine: assets − liabilities = net worth (reconciles with raw SQL)', () => {
  const nw = computeNetWorth(db, userId);

  // Independent recomputation straight from the database (not the engine).
  const cash = db.prepare(`SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE user_id=? AND is_liability=0`).get(userId).s;
  const liab = db.prepare(`SELECT COALESCE(SUM(balance_minor),0) s FROM accounts WHERE user_id=? AND is_liability=1`).get(userId).s;
  const invest = db.prepare(`
    SELECT COALESCE(SUM(ROUND(CAST(h.quantity AS REAL) * s.price_minor)),0) v
    FROM holdings h JOIN securities s ON s.id=h.security_id WHERE h.user_id=?`).get(userId).v;

  assert.equal(nw.totalLiabilitiesMinor, liab, 'liabilities reconcile with liability records');
  assert.equal(nw.totalAssetsMinor, cash + invest, 'assets = cash balances + holding market values');
  assert.equal(nw.netWorthMinor, nw.totalAssetsMinor - nw.totalLiabilitiesMinor, 'assets − liabilities = net worth');
  assert.ok(nw.totalAssetsMinor > 0 && nw.totalLiabilitiesMinor > 0);
});

test('portfolio engine: totals reconcile with individual holdings', () => {
  const pf = computePortfolio(db, userId);
  const vals = getHoldingsValuation(db, userId);
  assert.equal(vals.length, 12);

  let sum = 0;
  for (const h of vals) {
    const recomputed = Math.round(Number(h.quantity) * h.priceMinor);
    assert.equal(h.currentValueMinor, recomputed, `${h.securityName}: qty×price`);
    sum += recomputed;
    assert.equal(h.pnlMinor, h.currentValueMinor - h.costBasisMinor);
  }
  assert.equal(pf.totalValueMinor, sum, 'portfolio total = Σ holdings');
  assert.equal(pf.validation.invariantHolds, true);
  assert.equal(pf.validation.mismatches, 0);
  assert.equal(pf.totalPnlMinor, pf.totalValueMinor - pf.totalCostMinor);
  assert.ok(Math.abs(pf.totalPnlPct - (pf.totalPnlMinor / pf.totalCostMinor)) < 1e-9);
});

test('debt metrics reconcile with the two liability records', () => {
  const liabs = db.prepare('SELECT * FROM accounts WHERE user_id=? AND is_liability=1').all(userId);
  assert.equal(liabs.length, 2, 'exactly the credit card and the home loan');
  const names = liabs.map((l) => l.type).sort();
  assert.deepEqual(names, ['credit', 'loan']);
  const sum = liabs.reduce((s, l) => s + Number(l.balance_minor), 0);
  const nw = computeNetWorth(db, userId);
  assert.equal(nw.totalLiabilitiesMinor, sum);
  const byType = Object.fromEntries(nw.byType.map((t) => [t.name, t.valueMinor]));
  assert.ok(byType.loan > 0 && byType.credit > 0, 'debt breakdown reflects liability types');
});

test('no fabricated totals: engine values equal independently-summed SQL values', () => {
  // If totals were hard-coded anywhere, they would diverge from the SQL sums.
  const pf = computePortfolio(db, userId);
  const sqlTotal = db.prepare(`
    SELECT COALESCE(SUM(ROUND(CAST(h.quantity AS REAL) * s.price_minor)),0) v
    FROM holdings h JOIN securities s ON s.id=h.security_id WHERE h.user_id=?`).get(userId).v;
  assert.equal(pf.totalValueMinor, sqlTotal);

  const result = pf.byAssetClass.reduce((s, c) => s + c.valueMinor, 0);
  assert.equal(result, sqlTotal, 'asset-class breakdown sums to the portfolio total');
});

test('asset-class breakdown covers every asset account class once', () => {
  const nw = computeNetWorth(db, userId);
  const classes = Object.fromEntries(nw.assetClassBreakdown.map((c) => [c.name, c.valueMinor]));
  assert.ok(classes.cash > 0, 'savings + current + brokerage idle cash');
  assert.ok(classes.fixed_deposit > 0, 'FD + RD');
  assert.ok(classes.equity > 0, 'equity holdings');
  assert.ok(classes.mutual_fund > 0);
  assert.ok(classes.gold > 0);
  assert.ok(classes.other > 0, 'retirement (EPF/PPF/NPS) records as other assets');
  const classSum = nw.assetClassBreakdown.reduce((s, c) => s + c.valueMinor, 0);
  assert.equal(classSum, nw.totalAssetsMinor, 'breakdown reconciles with total assets');
});
