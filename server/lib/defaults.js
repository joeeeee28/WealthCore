// WealthCore — default categories and clearly-labelled demo data.
//
// Demo data is ALWAYS flagged is_demo=1 and source='manual' so it can never be
// mistaken for live financial data. It exists solely to let a new user explore
// the product without entering real data. Nothing is ever presented as LIVE.

import { computeNetWorth } from './networth.js';

export const DEFAULT_CATEGORIES = [
  ['Salary', 'income', '#3b82f6', 'salary'],
  ['Interest', 'income', '#22c55e', 'interest'],
  ['Dividends', 'income', '#059669', 'dividend'],
  ['Groceries', 'expense', '#22c55e', 'groceries'],
  ['Rent', 'expense', '#8b5cf6', 'rent'],
  ['Utilities', 'expense', '#f59e0b', 'utilities'],
  ['Internet', 'expense', '#06b6d4', 'internet'],
  ['Mobile', 'expense', '#14b8a6', 'mobile'],
  ['Dining', 'expense', '#ef4444', 'dining'],
  ['Travel', 'expense', '#f97316', 'travel'],
  ['Subscriptions', 'expense', '#a855f7', 'subscriptions'],
  ['Insurance', 'expense', '#64748b', 'insurance'],
  ['EMI', 'expense', '#ef4444', 'emi'],
  ['Deposits', 'savings', '#22c55e', 'deposits'],
  ['Mutual Funds', 'investment', '#3b82f6', 'mf'],
  ['Uncategorized', 'expense', '#94a3b8', 'uncategorized'],
];

export function ensureDefaultCategories(db, userId) {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (user_id, name, kind, color, icon) VALUES (?, ?, ?, ?, ?)');
  for (const [name, kind, color, icon] of DEFAULT_CATEGORIES) {
    insert.run(userId, name, kind, color, icon);
  }
}

/**
 * Populate clearly-labelled demo data for a user. All records are marked
 * is_demo=1 and source='manual'. Only call this when the user has no data.
 */
export function seedDemoData(db, userId) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lm = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const day = (ymd) => `${ymd}`;

  // Accounts
  const addAcct = db.prepare(`INSERT INTO accounts (user_id, name, type, institution, currency, balance_minor, is_liability, source, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 1)`);
  const salaryAcct = addAcct.run(userId, 'Salary Account', 'savings', 'Example Bank', 'INR', 25000000, 0).lastInsertRowid; // 250,000.00
  const checkingAcct = addAcct.run(userId, 'Current Account', 'current', 'Example Bank', 'INR', 8500000, 0).lastInsertRowid; // 85,000.00
  const creditCard = addAcct.run(userId, 'Credit Card', 'credit', 'Example Bank', 'INR', 4250000, 1).lastInsertRowid; // 42,500 owed
  const brokerage = addAcct.run(userId, 'Brokerage', 'brokerage', 'Example Broker', 'INR', 0, 0).lastInsertRowid;
  const homeLoan = addAcct.run(userId, 'Home Loan', 'loan', 'Example Bank', 'INR', 185000000, 1).lastInsertRowid; // 18.5L owed (example)
  const house = addAcct.run(userId, 'Home', 'real_estate', 'Example Property', 'INR', 280000000, 0).lastInsertRowid; // 28.00L (example)

  // Securities + holdings (MANUAL / LAST_AVAILABLE prices — never LIVE)
  const addSec = db.prepare(`INSERT INTO securities (user_id, ticker, name, exchange, asset_class, currency, price_minor, price_status, provider, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const sec1 = addSec.run(userId, 'RELIANCE', 'Reliance Industries', 'NSE', 'equity', 'INR', 295000, 'LAST_AVAILABLE', 'Example Feed').lastInsertRowid; // 2950.00
  const sec2 = addSec.run(userId, 'HDFCBANK', 'HDFC Bank', 'NSE', 'equity', 'INR', 168000, 'LAST_AVAILABLE', 'Example Feed').lastInsertRowid; // 1680.00
  const sec3 = addSec.run(userId, 'NIFTY50', 'Nifty 50 Index Fund', 'NSE', 'mutual_fund', 'INR', 24500, 'MANUAL', null).lastInsertRowid; // 245.00
  const sec4 = addSec.run(userId, 'GOLD', 'Gold ETF', 'NSE', 'gold', 'INR', 69000, 'MANUAL', null).lastInsertRowid; // 690.00
  const sec5 = addSec.run(userId, 'SGB2028', 'Sovereign Gold Bond 2028', 'RBI', 'gold', 'INR', 685000, 'MANUAL', null).lastInsertRowid; // 6850.00
  const sec6 = addSec.run(userId, 'BTC', 'Bitcoin', 'ExampleX', 'crypto', 'USD', 6050000, 'MANUAL', null).lastInsertRowid; // 60,500 USD

  const addHolding = db.prepare(`INSERT INTO holdings (user_id, account_id, security_id, quantity, cost_basis_minor, currency, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  addHolding.run(userId, brokerage, sec1, '10', 2450000, 'INR'); // 10 * 2950 = 29500
  addHolding.run(userId, brokerage, sec2, '20', 3200000, 'INR'); // 20 * 1680 = 33600
  addHolding.run(userId, brokerage, sec3, '120', 2400000, 'INR'); // 120 * 245 = 29400
  addHolding.run(userId, brokerage, sec4, '15', 960000, 'INR'); // 15 * 690 = 10350
  addHolding.run(userId, brokerage, sec5, '2', 1210000, 'INR'); // 2 * 6850 = 13700
  addHolding.run(userId, brokerage, sec6, '0.01', 550000, 'USD'); // 0.01 * 60500 = 605 USD

  // Categories already seeded via ensureDefaultCategories.

  // Transactions
  const cat = (name) => db.prepare('SELECT id FROM categories WHERE user_id=? AND name=?').get(userId, name)?.id;
  const addTx = db.prepare(`INSERT INTO transactions (user_id, account_id, date, amount_minor, currency, direction, kind, category_id, merchant, source, is_demo, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?)`);
  const txns = [
    [salaryAcct, `${ym}-01`, 15000000, 'INR', 'in', 'income', cat('Salary'), 'ACME Corp Salary'],
    [salaryAcct, `${ym}-05`, 1800000, 'INR', 'out', 'expense', cat('Rent'), 'Landlord Rent'],
    [checkingAcct, `${ym}-07`, 1240000, 'INR', 'out', 'expense', cat('Groceries'), 'BigBasket Groceries'],
    [checkingAcct, `${ym}-08`, 780000, 'INR', 'out', 'expense', cat('Groceries'), 'Food Mart'],
    [checkingAcct, `${ym}-12`, 860000, 'INR', 'out', 'expense', cat('Utilities'), 'Electricity Bill'],
    [checkingAcct, `${ym}-15`, 580000, 'INR', 'out', 'expense', cat('Dining'), 'Swiggy'],
    [checkingAcct, `${ym}-18`, 1860000, 'INR', 'out', 'expense', cat('EMI'), 'Car Loan EMI'],
    [checkingAcct, `${ym}-20`, 650000, 'INR', 'out', 'expense', cat('Subscriptions'), 'Netflix'],
    [checkingAcct, `${ym}-22`, 749000, 'INR', 'out', 'expense', cat('Mobile'), 'Jio Recharge'],
    [salaryAcct, `${ym}-25`, 1200000, 'INR', 'out', 'investment', cat('Mutual Funds'), 'SIP Index Fund'],
    [salaryAcct, `${lm}-01`, 15000000, 'INR', 'in', 'income', cat('Salary'), 'ACME Corp Salary'],
    [salaryAcct, `${lm}-05`, 1800000, 'INR', 'out', 'expense', cat('Rent'), 'Landlord Rent'],
    [checkingAcct, `${lm}-09`, 1180000, 'INR', 'out', 'expense', cat('Groceries'), 'BigBasket Groceries'],
    [checkingAcct, `${lm}-11`, 640000, 'INR', 'out', 'expense', cat('Groceries'), 'Food Mart'],
    [checkingAcct, `${lm}-14`, 720000, 'INR', 'out', 'expense', cat('Dining'), 'Zomato'],
    [checkingAcct, `${lm}-18`, 1860000, 'INR', 'out', 'expense', cat('EMI'), 'Car Loan EMI'],
  ];
  for (const t of txns) {
    const dedup = `${t[0]}|${t[1]}|${t[2]}|${t[3]}|${t[5]}`;
    addTx.run(userId, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], dedup);
  }

  // Goals
  const addGoal = db.prepare(`INSERT INTO goals (user_id, name, target_amount_minor, current_amount_minor, currency, status, is_demo) VALUES (?, ?, ?, ?, ?, 'active', 1)`);
  addGoal.run(userId, 'Emergency Fund', 500000000, 320000000, 'INR'); // target 50L, current 32L
  addGoal.run(userId, 'Retirement Corpus', 8000000000, 3360000000, 'INR'); // 8Cr, 3.36Cr
  addGoal.run(userId, 'Child Education', 100000000, 18000000, 'INR');

  // Budgets
  const addBudget = db.prepare(`INSERT INTO budgets (user_id, category_id, period, amount_minor, currency, is_demo) VALUES (?, ?, 'monthly', ?, 'INR', 1)`);
  addBudget.run(userId, cat('Groceries'), 1500000); // 15,000/mo
  addBudget.run(userId, cat('Dining'), 800000); // 8,000/mo
  addBudget.run(userId, cat('Utilities'), 1000000); // 10,000/mo

  // Consent (pending — READY_FOR_CONFIGURATION)
  db.prepare(`INSERT INTO consents (user_id, provider, fi_type, purpose, status) VALUES (?, 'Example FIU', 'savings_account,credit_card', 'demo', 'pending')`).run(userId);

  // Snapshot
  const nw = computeNetWorth(db, userId);
  db.prepare(`INSERT INTO snapshots (user_id, as_of, total_assets_minor, total_liabilities_minor, net_worth_minor, data, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)`)
    .run(userId, new Date().toISOString().slice(0, 10), nw.totalAssetsMinor, nw.totalLiabilitiesMinor, nw.netWorthMinor, JSON.stringify(nw));

  // Notification
  db.prepare(`INSERT INTO notifications (user_id, type, title, body, severity) VALUES (?, 'info', 'Demo data loaded', 'This is clearly-labelled sample data (MANUAL/SANDBOX). Connect real accounts to replace it.', 'info')`)
    .run(userId);

  // Provider-reported (source) balances: a matched pair and a clear difference,
  // so reconciliation is demonstrable on sample data.
  db.prepare(`UPDATE accounts SET source_balance_minor=?, source_balance_currency='INR', source_balance_timestamp=datetime('now') WHERE id=?`)
    .run(25000000, salaryAcct);
  db.prepare(`UPDATE accounts SET source_balance_minor=?, source_balance_currency='INR', source_balance_timestamp=datetime('now') WHERE id=?`)
    .run(10000000, checkingAcct);

  return {
    accountCount: db.prepare('SELECT COUNT(*) c FROM accounts WHERE user_id=?').get(userId).c,
    holdingCount: db.prepare('SELECT COUNT(*) c FROM holdings WHERE user_id=?').get(userId).c,
  };
}

export default { DEFAULT_CATEGORIES, ensureDefaultCategories, seedDemoData };
