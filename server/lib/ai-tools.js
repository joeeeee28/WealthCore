// WealthCore — AI tool layer.
//
// Every tool here reads REAL data from the database and returns REAL values.
// The AI never computes financial figures itself: it calls these tools, which
// delegate to the deterministic calculation engines. This enforces ABSOLUTE
// RULE 6 (no LLM financial calculation) and prevents hallucinated data.

import * as money from './money.js';
import { computeNetWorth } from './networth.js';
import { computePortfolio } from './portfolio.js';
import { aaIntegrationStatus, expireConsents } from './aa-integration.js';
import { marketProviderConfig } from './market-data.js';
import { runAllReconciliations } from './reconciliation.js';
import * as calc from './calculations.js';

function monthRange(ym) {
  // ym = 'YYYY-MM'
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function previousMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMoney(minor, currency = 'INR') {
  return money.format(Number(minor), currency);
}

export function toolGetNetWorth(db, userId) {
  const nw = computeNetWorth(db, userId);
  return {
    totalAssetsMinor: nw.totalAssetsMinor,
    totalLiabilitiesMinor: nw.totalLiabilitiesMinor,
    netWorthMinor: nw.netWorthMinor,
    _display: `Net worth ${fmtMoney(nw.netWorthMinor)} (assets ${fmtMoney(nw.totalAssetsMinor)}, liabilities ${fmtMoney(nw.totalLiabilitiesMinor)})`,
  };
}

export function toolGetAccounts(db, userId) {
  const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY name').all(userId);
  return rows.map((a) => ({
    id: a.id, name: a.name, type: a.type, currency: a.currency,
    balanceMinor: a.balance_minor, isLiability: a.is_liability,
    _display: `${a.name} (${a.type}): ${fmtMoney(a.balance_minor, a.currency)}`,
  }));
}

export function toolGetAccountBalance(db, userId, { account } = {}) {
  let row;
  if (account) {
    const like = `%${account.toLowerCase()}%`;
    row = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND LOWER(name) LIKE ? LIMIT 1').get(userId, like);
  }
  if (!row) {
    const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY name').all(userId);
    if (rows.length === 1) row = rows[0];
  }
  if (!row) {
    return { found: false, _display: 'No matching account found. Ask me to list all accounts.' };
  }
  return {
    found: true, accountId: row.id, name: row.name, type: row.type,
    balanceMinor: row.balance_minor, currency: row.currency,
    _display: `${row.name} ${fmtMoney(row.balance_minor, row.currency)}`,
  };
}

export function toolGetTransactionTotal(db, userId, { month, direction = 'out', category } = {}) {
  const ym = month || currentMonth();
  const { start, end } = monthRange(ym);
  let sql = `SELECT SUM(t.amount_minor) sum FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.direction = ? AND t.status = 'active'`;
  const params = [userId, start, end, direction];
  if (category) {
    sql += ' AND (LOWER(c.name) LIKE ? OR LOWER(t.merchant) LIKE ?)';
    const like = `%${category.toLowerCase()}%`;
    params.push(like, like);
  }
  const row = db.prepare(sql).get(...params);
  const total = Number(row.sum || 0);
  return {
    month: ym, direction, category: category || null, totalMinor: total,
    _display: `${category ? category + ' spending' : (direction === 'out' ? 'Spending' : 'Income')} in ${ym}: ${fmtMoney(total)}`,
  };
}

export function toolGetPortfolio(db, userId) {
  const p = computePortfolio(db, userId);
  return {
    totalValueMinor: p.totalValueMinor,
    totalCostMinor: p.totalCostMinor,
    totalPnlMinor: p.totalPnlMinor,
    totalPnlPct: p.totalPnlPct,
    holdingsCount: p.holdingsCount,
    unpricedCount: p.unpricedCount,
    _display: `Portfolio value ${fmtMoney(p.totalValueMinor)}; invested ${fmtMoney(p.totalCostMinor)}; P&L ${fmtMoney(p.totalPnlMinor)} (${(p.totalPnlPct * 100).toFixed(2)}%)`,
  };
}

export function toolGetMonthlyExpenses(db, userId, { month } = {}) {
  const ym = month || currentMonth();
  const { start, end } = monthRange(ym);
  const rows = db.prepare(`
    SELECT c.name category, COALESCE(SUM(t.amount_minor),0) total
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.direction = 'out' AND t.status = 'active'
    GROUP BY c.name ORDER BY total DESC
  `).all(userId, start, end);
  const total = rows.reduce((a, r) => a + Number(r.total), 0);
  return {
    month: ym, totalMinor: total,
    byCategory: rows.map((r) => ({ category: r.category || 'Uncategorized', totalMinor: Number(r.total), _display: `${r.category || 'Uncategorized'} ${fmtMoney(r.total)}` })),
    _display: `Total spending in ${ym}: ${fmtMoney(total)}`,
  };
}

export function toolGetGoals(db, userId) {
  const rows = db.prepare('SELECT * FROM goals WHERE user_id = ? AND status = ?').all(userId, 'active');
  return rows.map((g) => ({
    id: g.id, name: g.name, targetMinor: g.target_amount_minor,
    currentMinor: g.current_amount_minor, currency: g.currency,
    progress: g.target_amount_minor ? (g.current_amount_minor / g.target_amount_minor) : 0,
    _display: `${g.name}: ${(g.current_amount_minor / g.target_amount_minor * 100).toFixed(0)}% (${fmtMoney(g.current_amount_minor, g.currency)} of ${fmtMoney(g.target_amount_minor, g.currency)})`,
  }));
}

export function toolGetBudgets(db, userId) {
  const rows = db.prepare(`
    SELECT b.*, c.name category FROM budgets b
    LEFT JOIN categories c ON c.id = b.category_id
    WHERE b.user_id = ? ORDER BY b.created_at
  `).all(userId);
  const now = currentMonth();
  const { start, end } = monthRange(now);
  return rows.map((b) => {
    const spent = Number(db.prepare(`
      SELECT COALESCE(SUM(amount_minor),0) s FROM transactions
      WHERE user_id = ? AND category_id = ? AND date >= ? AND date < ? AND direction='out' AND status='active'
    `).get(userId, b.category_id, start, end).s || 0);
    return {
      id: b.id, category: b.category || 'All', budgetMinor: b.amount_minor,
      spentMinor: spent, currency: b.currency,
      _display: `${b.category || 'All'} budget ${fmtMoney(b.amount_minor, b.currency)}; spent ${fmtMoney(spent, b.currency)}`,
    };
  });
}

export function toolGetConsentStatus(db, userId) {
  expireConsents(db, userId);
  const rows = db.prepare('SELECT * FROM consents WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const integration = aaIntegrationStatus();
  return {
    integration: integration.integration,
    status: integration.status,
    configured: integration.configured,
    consents: rows.map((c) => ({ provider: c.provider, fiType: c.fi_type, status: c.status })),
    _display: `AA integration: ${integration.integration} (${integration.status}). Consents: ${rows.length}`,
  };
}

export function toolGetSyncStatus(db, userId) {
  const runs = db.prepare('SELECT * FROM sync_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(userId);
  const last = runs[0] || null;
  const mkt = marketProviderConfig();
  return {
    lastRun: last ? { provider: last.provider, status: last.status, recordsProcessed: last.records_processed } : null,
    marketProviderConfigured: mkt.configured,
    _display: last ? `Last sync: ${last.provider} ${last.status} (${last.records_processed} records)` : 'No sync runs yet. AA provider not configured.',
  };
}

export function toolGetNetWorthHistory(db, userId) {
  const rows = db.prepare('SELECT * FROM snapshots WHERE user_id = ? ORDER BY as_of DESC LIMIT 12').all(userId);
  return {
    snapshots: rows.map((r) => ({ asOf: r.as_of, netWorthMinor: r.net_worth_minor })),
    _display: `${rows.length} snapshots recorded`,
  };
}

export function toolGetIncome(db, userId, { month } = {}) {
  return toolGetTransactionTotal(db, userId, { month, direction: 'in' });
}

export function toolGetExpenses(db, userId, { month, category } = {}) {
  return toolGetMonthlyExpenses(db, userId, { month, category });
}

export function toolGetBudget(db, userId, { category } = {}) {
  let sql = `SELECT b.*, c.name category FROM budgets b LEFT JOIN categories c ON c.id = b.category_id WHERE b.user_id = ?`;
  const params = [userId];
  if (category) { sql += ' AND LOWER(c.name) = LOWER(?)'; params.push(category); }
  sql += ' ORDER BY b.created_at LIMIT 20';
  const rows = db.prepare(sql).all(...params);
  const now = currentMonth();
  const { start, end } = monthRange(now);
  return rows.map((b) => {
    const spent = Number(db.prepare(`SELECT COALESCE(SUM(amount_minor),0) s FROM transactions WHERE user_id=? AND category_id=? AND date>=? AND date<? AND direction='out' AND status='active'`).get(userId, b.category_id, start, end).s || 0);
    return { id: b.id, category: b.category || 'All', budgetMinor: b.amount_minor, spentMinor: spent, currency: b.currency, _display: `${b.category || 'All'} budget ${fmtMoney(b.amount_minor, b.currency)}; spent ${fmtMoney(spent, b.currency)}` };
  });
}

export function toolGetHoldings(db, userId) {
  const p = computePortfolio(db, userId);
  return p.holdings.map((h) => ({
    security: h.securityName, ticker: h.ticker, assetClass: h.assetClass, quantity: h.quantity,
    priceMinor: h.priceMinor, costBasisMinor: h.costBasisMinor, currentValueMinor: h.currentValueMinor,
    pnlMinor: h.pnlMinor, priceStatus: h.priceStatus, currency: h.currency,
    _display: `${h.securityName}: ${h.quantity} @ ${h.priceMinor != null ? priceFmt(h.priceMinor, h.currency) : 'no price'} = ${fmtMoney(h.currentValueMinor, h.currency)}`,
  }));
}

function priceFmt(minor, currency) { return money.format(Number(minor), currency); }

export function toolGetMarketPrice(db, userId, { ticker, name } = {}) {
  let row;
  if (ticker) row = db.prepare('SELECT * FROM securities WHERE user_id=? AND LOWER(ticker)=?').get(userId, String(ticker).toLowerCase());
  if (!row && name) row = db.prepare('SELECT * FROM securities WHERE user_id=? AND LOWER(name) LIKE ?').get(userId, `%${String(name).toLowerCase()}%`);
  if (!row) return { found: false, _display: 'No matching security found.' };
  return {
    found: true, securityId: row.id, name: row.name, ticker: row.ticker, assetClass: row.asset_class,
    priceMinor: row.price_minor, priceStatus: row.price_status, priceTimestamp: row.price_timestamp, currency: row.currency,
    _display: `${row.name} is ${row.price_minor != null ? fmtMoney(row.price_minor, row.currency) : 'not priced'} (${row.price_status.replace('_', ' ')})`,
  };
}

export function toolGetReconciliation(db, userId) {
  const { summary } = runAllReconciliations(db, userId);
  return {
    summary,
    _display: `${summary.matched} matched, ${summary.difference} difference, ${summary.duplicate} duplicate, ${summary.missingSource} missing source of ${summary.total} accounts`,
  };
}

export function toolGetDataFreshness(db, userId) {
  const latest = db.prepare(`SELECT MAX(created_at) m FROM transactions WHERE user_id=?`).get(userId);
  const latestMarket = db.prepare(`SELECT MAX(price_timestamp) m FROM securities WHERE user_id=?`).get(userId);
  const latestSync = db.prepare(`SELECT MAX(created_at) m FROM sync_runs WHERE user_id=?`).get(userId);
  const lastTxn = latest && latest.m ? latest.m : null;
  const lastMkt = latestMarket && latestMarket.m ? latestMarket.m : null;
  const lastSync = latestSync && latestSync.m ? latestSync.m : null;
  const ageIso = (iso) => iso ? Math.round((Date.now() - new Date(iso).getTime()) / 3600000) + 'h' : 'never';
  return {
    lastTransaction: lastTxn, lastMarketPrice: lastMkt, lastSync: lastSync,
    _display: `Transactions ${lastTxn ? ageIso(lastTxn) : 'never'}; market ${lastMkt ? ageIso(lastMkt) : 'never'}; sync ${lastSync ? ageIso(lastSync) : 'never'}`,
  };
}

export function toolComparePeriods(db, userId, { monthA, monthB, direction = 'out' } = {}) {
  const a = toolGetTransactionTotal(db, userId, { month: monthA || currentMonth(), direction });
  const b = toolGetTransactionTotal(db, userId, { month: monthB || previousMonth(), direction });
  const diff = a.totalMinor - b.totalMinor;
  return {
    monthA: a.month, monthB: b.month, aMinor: a.totalMinor, bMinor: b.totalMinor, differenceMinor: diff,
    _display: `${a.month} ${fmtMoney(a.totalMinor)} vs ${b.month} ${fmtMoney(b.totalMinor)} (${diff >= 0 ? '+' : ''}${fmtMoney(diff)})`,
  };
}

// Deterministic calculators exposed as tools (never let the LLM compute).
export function toolCalculate(db, userId, { type, ...args }) {
  const result = (() => {
    if (type === 'emi') return { value: calc.emi(Number(args.principal), Number(args.annualRatePercent) / 100, Number(args.months)) };
    if (type === 'sip') return { value: calc.sipFutureValue(Number(args.monthlyInvestment), Number(args.annualRatePercent) / 100, Number(args.months), args.atBeginning !== false) };
    if (type === 'fd') return { value: calc.fdMaturity(Number(args.principal), Number(args.annualRatePercent) / 100, Number(args.compoundingPerYear || 4), Number(args.years)) };
    if (type === 'cagr') return { value: calc.cagr(Number(args.beginValue), Number(args.endValue), Number(args.years)) };
    if (type === 'xirr') return { value: calc.xirr((args.flows || []).map((f) => ({ date: f.date, amount: Number(f.amount) }))) };
    return { value: null };
  })();
  return { type, value: result.value, _display: `${type}: ${result.value != null ? result.value.toFixed(4) : 'n/a'}` };
}

// --- Tool registry -------------------------------------------------------

export const TOOLS = {
  get_net_worth: { fn: toolGetNetWorth, schema: { name: 'get_net_worth', description: 'Get current net worth (assets minus liabilities) with latest market values.', parameters: { type: 'object', properties: {} } } },
  get_accounts: { fn: toolGetAccounts, schema: { name: 'get_accounts', description: 'List all linked financial accounts with balances.', parameters: { type: 'object', properties: {} } } },
  get_account_balance: { fn: toolGetAccountBalance, schema: { name: 'get_account_balance', description: 'Get the balance of a specific account by name.', parameters: { type: 'object', properties: { account: { type: 'string', description: 'Account name keyword' } } } } },
  get_transaction_total: { fn: toolGetTransactionTotal, schema: { name: 'get_transaction_total', description: 'Total income or spending for a month, optionally filtered by category.', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' }, direction: { type: 'string', enum: ['in', 'out'] }, category: { type: 'string' } } } } },
  get_portfolio: { fn: toolGetPortfolio, schema: { name: 'get_portfolio', description: 'Get investment portfolio value, cost and P&L.', parameters: { type: 'object', properties: {} } } },
  get_monthly_expenses: { fn: toolGetMonthlyExpenses, schema: { name: 'get_monthly_expenses', description: 'Get spending breakdown by category for a month.', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } } } } },
  get_goals: { fn: toolGetGoals, schema: { name: 'get_goals', description: 'List active savings goals and progress.', parameters: { type: 'object', properties: {} } } },
  get_budgets: { fn: toolGetBudgets, schema: { name: 'get_budgets', description: 'List budget categories with budget vs spent.', parameters: { type: 'object', properties: {} } } },
  get_consent_status: { fn: toolGetConsentStatus, schema: { name: 'get_consent_status', description: 'Get AA integration and consent status.', parameters: { type: 'object', properties: {} } } },
  get_sync_status: { fn: toolGetSyncStatus, schema: { name: 'get_sync_status', description: 'Get last synchronization status.', parameters: { type: 'object', properties: {} } } },
  get_net_worth_history: { fn: toolGetNetWorthHistory, schema: { name: 'get_net_worth_history', description: 'Get historical net worth snapshots.', parameters: { type: 'object', properties: {} } } },
  get_income: { fn: toolGetIncome, schema: { name: 'get_income', description: 'Total income for a month.', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } } } } },
  get_expenses: { fn: toolGetExpenses, schema: { name: 'get_expenses', description: 'Spending breakdown by category for a month.', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } } } } },
  get_budget: { fn: toolGetBudget, schema: { name: 'get_budget', description: 'Budgets with spend vs limit.', parameters: { type: 'object', properties: { category: { type: 'string' } } } } },
  get_holdings: { fn: toolGetHoldings, schema: { name: 'get_holdings', description: 'List all investment holdings with value and P&L.', parameters: { type: 'object', properties: {} } } },
  get_market_price: { fn: toolGetMarketPrice, schema: { name: 'get_market_price', description: 'Get the market price of a security.', parameters: { type: 'object', properties: { ticker: { type: 'string' }, name: { type: 'string' } } } } },
  get_reconciliation: { fn: toolGetReconciliation, schema: { name: 'get_reconciliation', description: 'Get reconciliation status across accounts.', parameters: { type: 'object', properties: {} } } },
  get_data_freshness: { fn: toolGetDataFreshness, schema: { name: 'get_data_freshness', description: 'Get data freshness (last transaction, market price, sync).', parameters: { type: 'object', properties: {} } } },
  compare_periods: { fn: toolComparePeriods, schema: { name: 'compare_periods', description: 'Compare income/expense between two months.', parameters: { type: 'object', properties: { monthA: { type: 'string' }, monthB: { type: 'string' }, direction: { type: 'string', enum: ['in', 'out'] } } } } },
  calculate: { fn: toolCalculate, schema: { name: 'calculate', description: 'Determine a financial value (emi, sip, fd, cagr, xirr) from inputs.', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['emi', 'sip', 'fd', 'cagr', 'xirr'] } } } } },
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);

export { currentMonth, previousMonth };

export default {
  TOOLS, TOOL_SCHEMAS,
  currentMonth, previousMonth,
};
