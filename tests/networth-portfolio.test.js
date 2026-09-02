// Net worth + portfolio engine tests against a real (in-memory) SQLite db.
// Enforces the single-source-of-truth invariants and the quantity×price rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WEALTHCORE_DB = ':memory:';
const { getDb } = await import('../server/db.js');
const { computeNetWorth, getHoldingsValuation } = await import('../server/lib/networth.js');
const { computePortfolio } = await import('../server/lib/portfolio.js');

function setup() {
  const db = getDb();
  db.exec('DELETE FROM transactions; DELETE FROM holdings; DELETE FROM securities; DELETE FROM accounts; DELETE FROM users;');
  const u = db.prepare(`INSERT INTO users (email, name, password_hash, password_salt) VALUES ('t','T','x','y')`).run();
  const userId = u.lastInsertRowid;
  const acct = (name, type, bal, liab) => db.prepare(
    `INSERT INTO accounts (user_id, name, type, currency, balance_minor, is_liability, source) VALUES (?,?,?,'INR',?,?,'manual')`)
    .run(userId, name, type, bal, liab ? 1 : 0).lastInsertRowid;
  return { db, userId, acct };
}

test('net worth = assets − liabilities (single source of truth)', () => {
  const { db, userId, acct } = setup();
  const savings = acct('Savings', 'savings', 50000000, false);
  const credit = acct('Credit', 'credit', 12000000, true);
  const loan = acct('Loan', 'loan', 30000000, true);
  const nw = computeNetWorth(db, userId);
  assert.equal(nw.totalAssetsMinor, 50000000);
  assert.equal(nw.totalLiabilitiesMinor, 42000000);
  assert.equal(nw.netWorthMinor, 8000000);
});

test('holdings add market value to assets via quantity × price', () => {
  const { db, userId, acct } = setup();
  const savings = acct('Savings', 'savings', 10000000, false);
  const broker = acct('Broker', 'brokerage', 0, false);
  const sec = db.prepare(`INSERT INTO securities (user_id, ticker, name, asset_class, currency, price_minor, price_status) VALUES (?,?,'Stock','equity','INR',15000,'LAST_AVAILABLE')`)
    .run(userId, 'ABC').lastInsertRowid;
  db.prepare(`INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency) VALUES (?,?,?,?,?,'INR')`)
    .run(userId, broker, sec, '10', 120000); // 10 shares, cost ₹1,200.00

  const nw = computeNetWorth(db, userId);
  // assets = savings(₹1,000) + holding(10*₹150=₹1,500) = ₹2,500
  assert.equal(nw.totalAssetsMinor, 10000000 + 150000);

  const p = computePortfolio(db, userId);
  assert.equal(p.totalValueMinor, 150000);
  assert.equal(p.totalCostMinor, 120000);
  assert.equal(p.totalPnlMinor, 30000); // ₹1,500 - ₹1,200 = ₹300
  assert.equal(p.validation.invariantHolds, true);
  assert.equal(p.validation.mismatches, 0);
});

test('unpriced security is flagged, not faked as live', () => {
  const { db, userId, acct } = setup();
  acct('Cash', 'savings', 0, false);
  const broker = acct('Broker', 'brokerage', 0, false);
  const sec = db.prepare(`INSERT INTO securities (user_id, ticker, name, asset_class, currency, price_minor, price_status) VALUES (?,?,'Stock','equity','INR',NULL,'MANUAL')`)
    .run(userId, 'XYZ').lastInsertRowid;
  db.prepare(`INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency) VALUES (?,?,?,?,?,'INR')`)
    .run(userId, broker, sec, '5', 2000000); // cost 2000, no price

  const p = computePortfolio(db, userId);
  assert.equal(p.unpricedCount, 1);
  assert.equal(p.holdings[0].priceMissing, true);
  assert.equal(p.holdings[0].priceStatus, 'MANUAL');
});

test('mixed currencies are surfaced separately (no silent FX mixing)', () => {
  const { db, userId, acct } = setup();
  acct('INR Savings', 'savings', 5000000, false); // ₹50,000
  // Insert a USD-denominated account directly (the setup helper hard-codes INR).
  db.prepare(`INSERT INTO accounts (user_id, name, type, currency, balance_minor, is_liability, source) VALUES (?,?,'current','USD',?,?,'manual')`)
    .run(userId, 'USD Cash', 6050000, 0); // $60,500 — NOT converted to INR
  acct('INR Loan', 'loan', 2000000, true); // ₹20,000

  const nw = computeNetWorth(db, userId);
  assert.equal(nw.mixedCurrency, true);
  assert.equal(nw.baseCurrency, 'INR');

  // INR-only row: assets ₹50,000, liabilities ₹20,000.
  const inr = nw.currencyBreakdown.find((c) => c.currency === 'INR');
  assert.ok(inr);
  assert.equal(inr.assetsMinor, 5000000);
  assert.equal(inr.liabilitiesMinor, 2000000);
  assert.equal(inr.netWorthMinor, 3000000);

  // USD row is isolated so a USD minor is never treated as an INR minor.
  const usd = nw.currencyBreakdown.find((c) => c.currency === 'USD');
  assert.ok(usd);
  assert.equal(usd.assetsMinor, 6050000);
  assert.equal(usd.liabilitiesMinor, 0);
  assert.equal(usd.netWorthMinor, 6050000);
});
