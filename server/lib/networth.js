// WealthCore — Net Worth Engine.
//
// SINGLE SOURCE OF TRUTH. Every surface (dashboard, portfolio, reports, AI,
// analytics) must call computeNetWorth() and must NOT re-derive net worth with
// different logic.
//
//   Assets      = non-liability cash balances + current market value of holdings
//   Liabilities = balances of liability accounts (loans, credit cards)
//   Net Worth   = Assets - Liabilities
//
// All values are returned as integer minor units. No rounding is applied by the
// engine; the caller decides presentation.

import * as money from './money.js';

const TYPE_TO_CLASS = {
  savings: 'cash',
  current: 'cash',
  fd: 'fixed_deposit',
  brokerage: 'cash',
  mutual_fund: 'mutual_fund',
  crypto: 'crypto',
  gold: 'gold',
  real_estate: 'real_estate',
  other: 'other',
};

export function computeNetWorth(db, userId) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
  const holdings = getHoldingsValuation(db, userId);

  let totalAssetsMinor = 0;
  let totalLiabilitiesMinor = 0;
  const assetClasses = new Map();
  const byType = new Map();

  // Per-currency tracking so a USD balance is never silently added to an INR
  // headline. This surfaces mixed-currency exposure; no FX conversion is applied.
  const perCurrency = new Map();
  const addPerCurrency = (currency, kind, amt) => {
    const c = String(currency || 'INR').toUpperCase();
    if (!perCurrency.has(c)) perCurrency.set(c, { currency: c, assetsMinor: 0, liabilitiesMinor: 0, netWorthMinor: 0 });
    const row = perCurrency.get(c);
    if (kind === 'liability') row.liabilitiesMinor = money.add(row.liabilitiesMinor, amt);
    else row.assetsMinor = money.add(row.assetsMinor, amt);
  };

  for (const acct of accounts) {
    const amt = Number(acct.balance_minor);
    const cur = String(acct.currency || 'INR').toUpperCase();
    if (acct.is_liability) {
      totalLiabilitiesMinor = money.add(totalLiabilitiesMinor, amt);
      addPerCurrency(cur, 'liability', amt);
    } else {
      totalAssetsMinor = money.add(totalAssetsMinor, amt);
      addPerCurrency(cur, 'asset', amt);
      const cls = TYPE_TO_CLASS[acct.type] || 'other';
      assetClasses.set(cls, (assetClasses.get(cls) || 0) + amt);
    }
    const key = acct.type;
    byType.set(key, (byType.get(key) || 0) + amt);
  }

  // Add investment holdings current value (not cash double-counted; investment
  // accounts keep only their idle cash in balance_minor).
  for (const h of holdings) {
    totalAssetsMinor = money.add(totalAssetsMinor, h.currentValueMinor);
    addPerCurrency(h.currency, 'asset', h.currentValueMinor);
    const cls = h.assetClass || 'investments';
    assetClasses.set(cls, (assetClasses.get(cls) || 0) + h.currentValueMinor);
    const typeKey = `${h.accountType}:Investments`;
    byType.set(typeKey, (byType.get(typeKey) || 0) + h.currentValueMinor);
  }

  const totalAssetsDouble = Number(totalAssetsMinor);
  const totalLiabilitiesDouble = Number(totalLiabilitiesMinor);
  const netWorthMinor = Number(BigInt(totalAssetsDouble) - BigInt(totalLiabilitiesDouble));

  const currencyBreakdown = [...perCurrency.values()].map((r) => ({
    ...r, netWorthMinor: Number(BigInt(r.assetsMinor) - BigInt(r.liabilitiesMinor)),
  }));
  // NOTE: totalAssetsMinor/totalLiabilitiesMinor/netWorthMinor sum RAW minor
  // units across all currencies without FX conversion. When multiple currencies
  // are present the client should present the per-currency or FX-converted view
  // rather than treating a USD minor as equal to an INR minor.
  return {
    totalAssetsMinor,
    totalLiabilitiesMinor,
    netWorthMinor,
    baseCurrency: 'INR',
    currencyBreakdown,
    mixedCurrency: currencyBreakdown.length > 1,
    assetClassBreakdown: [...assetClasses.entries()].map(([name, value]) => ({
      name, valueMinor: value,
      pct: totalAssetsDouble ? (value / totalAssetsDouble) : 0,
    })),
    byType: [...byType.entries()].map(([name, value]) => ({ name, valueMinor: value })),
    accountCount: accounts.length,
    holdingCount: holdings.length,
  };
}

/** Market value of all holdings for a user (single source used by portfolio too). */
export function getHoldingsValuation(db, userId) {
  const rows = db.prepare(`
    SELECT h.id AS holding_id, h.quantity, h.cost_basis_minor, h.currency AS holding_currency,
           s.id AS security_id, s.name, s.ticker, s.exchange, s.asset_class,
           s.currency AS security_currency, s.price_minor, s.price_timestamp, s.price_status,
           a.id AS account_id, a.name AS account_name, a.type AS account_type
    FROM holdings h
    JOIN securities s ON s.id = h.security_id
    LEFT JOIN accounts a ON a.id = h.account_id
    WHERE h.user_id = ?
  `).all(userId);

  return rows.map((r) => {
    const qty = Number(r.quantity);
    let currentValueMinor;
    let priceMissing = false;
    let priceStatus = r.price_status || 'MANUAL';
    let priceMinor = r.price_minor == null ? null : Number(r.price_minor);

    if (priceMinor == null) {
      // No known price — do NOT fabricate a live value. Fall back to cost basis
      // as a conservative, clearly-flagged estimate.
      priceMissing = true;
      priceStatus = 'MANUAL';
      priceMinor = Number(r.cost_basis_minor);
      currentValueMinor = Math.round(Number(r.cost_basis_minor));
      // For an unpriced security we conservatively report 0 added gain at cost.
    } else {
      currentValueMinor = Math.round(qty * priceMinor);
    }

    const costBasisMinor = Number(r.cost_basis_minor);
    const pnlMinor = Number(BigInt(currentValueMinor) - BigInt(costBasisMinor));

    return {
      holdingId: r.holding_id,
      securityId: r.security_id,
      securityName: r.name,
      ticker: r.ticker,
      exchange: r.exchange,
      assetClass: r.asset_class,
      quantity: r.quantity,
      accountId: r.account_id,
      accountName: r.account_name,
      accountType: r.account_type,
      costBasisMinor,
      priceMinor,
      priceStatus,
      priceMissing,
      priceTimestamp: r.price_timestamp,
      currency: r.security_currency || r.holding_currency,
      currentValueMinor,
      pnlMinor,
      pnlPct: costBasisMinor ? (pnlMinor / costBasisMinor) : 0,
    };
  });
}

/** Write a net-worth snapshot row. */
export function recordSnapshot(db, userId, asOf = new Date().toISOString().slice(0, 10), isDemo = 0) {
  const nw = computeNetWorth(db, userId);
  db.prepare(`INSERT INTO snapshots
    (user_id, as_of, total_assets_minor, total_liabilities_minor, net_worth_minor, data, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, asOf, nw.totalAssetsMinor, nw.totalLiabilitiesMinor, nw.netWorthMinor,
         JSON.stringify(nw), isDemo);
  return nw;
}

export default { computeNetWorth, getHoldingsValuation, recordSnapshot };
