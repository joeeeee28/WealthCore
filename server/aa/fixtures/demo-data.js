// WealthCore — Demo data-environment fixtures (deterministic synthetic data).
//
// ##########################################################################
// # DEMO DATA — ALL FINANCIAL INFORMATION HERE IS SYNTHETIC.               #
// # NOT REAL FINANCIAL DATA. NO REAL BANK ACCOUNTS. NO REAL CREDENTIALS.   #
// ##########################################################################
//
// Every record is generated from a fixed PRNG seed so a demo load produces the
// exact same deterministic data set every time (idempotent re-loads dedup on
// the stable ids). Every record carries explicit synthetic markers:
//   source = 'DEMO', synthetic = true, DEMO-* ids/references  (is_demo = 1 in
//   the database; transactions are persisted with provider_ref DEMO-TXN-####).
//
// Fixture contract used by the financial-calculation and reconciliation tests:
//   * account.openingBalanceMinor + Σcredits − Σdebits = account.currentBalanceMinor
//   * holding.quantity × holding.priceMinor  = market value (engine-computed)
//   * assets − liabilities = net worth        (engine-computed, never hard-coded)

// ---------------------------------------------------------------------------
// Deterministic seeded PRNG: xmur3 string hash → mulberry32 stream.
// ---------------------------------------------------------------------------
export const DEMO_SEED = 'wealthcore-demo-v1';

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function seed() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoRng() {
  return mulberry32(xmur3(DEMO_SEED)());
}

const pad4 = (n) => String(n).padStart(4, '0');
const MINOR = 100; // 1 major currency unit = 100 minor units
const r = (major) => Math.round(major * MINOR);

// Fixed, deterministic history window: April 2026 → September 2026 (~5.5 months).
export const DEMO_HISTORY = Object.freeze({ from: '2026-04-01', to: '2026-09-30', months: [0, 1, 2, 3, 4, 5] });

function demoDate(monthOffset, day, hour = 10, minute = 0) {
  const base = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01 UTC
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, day, hour, minute));
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Demo FIPs — fictional financial information providers (never real banks).
// ---------------------------------------------------------------------------
export const DEMO_FIPS = Object.freeze([
  { fipId: 'DEMO-FIP-BANK-01', name: 'Demo National Bank (synthetic)', source: 'DEMO', synthetic: true },
  { fipId: 'DEMO-FIP-BANK-02', name: 'Demo Card Services (synthetic)', source: 'DEMO', synthetic: true },
  { fipId: 'DEMO-FIP-BROKER-01', name: 'Demo Broking House (synthetic)', source: 'DEMO', synthetic: true },
]);

// ---------------------------------------------------------------------------
// Accounts — exactly 7 AA-pipeline accounts (5 assets + 2 loan liabilities).
// Opening balances are fixture INPUTS; closing balances are DERIVED below from
// the generated transactions (opening + credits − debits = closing).
// ---------------------------------------------------------------------------
export const DEMO_ACCOUNT_DEFS = Object.freeze([
  { fipId: 'DEMO-FIP-BANK-01', linkRefNumber: 'DEMO-LINK-SAV-0001', maskedAccNumber: 'XXXXXX9001', accountType: 'SAVINGS', name: 'Demo Salary Savings Account (synthetic)', openingMajor: 100000 },
  { fipId: 'DEMO-FIP-BANK-01', linkRefNumber: 'DEMO-LINK-CUR-0002', maskedAccNumber: 'XXXXXX9002', accountType: 'CURRENT', name: 'Demo Current Account (synthetic)', openingMajor: 250000 },
  { fipId: 'DEMO-FIP-BANK-01', linkRefNumber: 'DEMO-LINK-FD-0003', maskedAccNumber: 'XXXXXX9003', accountType: 'TERM_DEPOSIT', name: 'Demo Fixed Deposit (synthetic)', openingMajor: 500000 },
  { fipId: 'DEMO-FIP-BROKER-01', linkRefNumber: 'DEMO-LINK-BRK-0004', maskedAccNumber: 'XXXXXX9004', accountType: 'BROKERAGE', name: 'Demo Brokerage / Demat (synthetic)', openingMajor: 12500 },
  { fipId: 'DEMO-FIP-BANK-02', linkRefNumber: 'DEMO-LINK-CC-0005', maskedAccNumber: 'XXXXXX9005', accountType: 'CREDIT_CARD', name: 'Demo Credit Card (synthetic)', openingMajor: 0, isLiability: true },
  { fipId: 'DEMO-FIP-BANK-01', linkRefNumber: 'DEMO-LINK-HL-0006', maskedAccNumber: 'XXXXXX9006', accountType: 'LOAN', name: 'Demo Home Loan (synthetic)', openingMajor: -1850000, isLiability: true },
  { fipId: 'DEMO-FIP-BANK-01', linkRefNumber: 'DEMO-LINK-RD-0007', maskedAccNumber: 'XXXXXX9007', accountType: 'RECURRING_DEPOSIT', name: 'Demo Recurring Deposit (synthetic)', openingMajor: 120000 },
]);

// ---------------------------------------------------------------------------
// Transaction generation plan. Fixed evaluation order → fixed RNG consumption
// order → deterministic amounts/dates. 180 transactions exactly.
// ---------------------------------------------------------------------------
// plan entry: { ref (account), type, category, baseMajor, spreadMajor, slots:[{m,d}] }
const everyMonth = (days) => DEMO_HISTORY.months.flatMap((m) => days.map((d) => ({ m, d })));
const extraDays = (day, months) => months.map((m) => ({ m, d: day }));

const CC_BILL_DAY = 27;

const TXN_PLAN = [
  // --- credits ---
  { ref: 'DEMO-LINK-SAV-0001', type: 'CREDIT', category: 'Salary', merchant: 'Demo Employer Payroll', baseMajor: 150000, spreadMajor: 0, slots: everyMonth([1]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'CREDIT', category: 'Interest', merchant: 'Demo Bank Interest Credit', baseMajor: 950, spreadMajor: 200, slots: everyMonth([28]) }, // 6
  { ref: 'DEMO-LINK-CUR-0002', type: 'CREDIT', category: 'Interest', merchant: 'Demo Dividend / Interest Credit', baseMajor: 1250, spreadMajor: 250, slots: extraDays(15, [0, 2, 3, 5]) }, // 4
  { ref: 'DEMO-LINK-CC-0005', type: 'CREDIT', category: 'Transfer', merchant: 'Credit card bill payment', baseMajor: 15000, spreadMajor: 3000, slots: everyMonth([CC_BILL_DAY]) }, // 6 (mirrored below)
  // --- debits from savings ---
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Housing', merchant: 'Demo Landlord Rent', baseMajor: 18000, spreadMajor: 0, slots: everyMonth([5]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'EMI/Debt', merchant: 'Demo Home Loan EMI', baseMajor: 18600, spreadMajor: 0, slots: everyMonth([10]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Investments', merchant: 'Demo SIP Index Fund', baseMajor: 12000, spreadMajor: 0, slots: everyMonth([15]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Insurance', merchant: 'Demo Term Insurance Premium', baseMajor: 2400, spreadMajor: 0, slots: everyMonth([20]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Utilities', merchant: 'Demo Electricity Board', baseMajor: 860, spreadMajor: 260, slots: everyMonth([12]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Utilities', merchant: 'Demo Mobile Recharge', baseMajor: 749, spreadMajor: 100, slots: everyMonth([22]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Utilities', merchant: 'Demo Broadband Bill', baseMajor: 999, spreadMajor: 0, slots: everyMonth([18]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Food', merchant: 'Demo Mart Groceries', baseMajor: 1240, spreadMajor: 480, slots: everyMonth([2, 9, 16, 23]) }, // 24
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Food', merchant: 'Demo Kitchen Dining', baseMajor: 580, spreadMajor: 320, slots: everyMonth([4, 11, 18]) }, // 18
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Education', merchant: 'Demo Academy Fees', baseMajor: 3500, spreadMajor: 500, slots: everyMonth([8]) }, // 6
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Other', merchant: 'Demo Miscellaneous', baseMajor: 750, spreadMajor: 250, slots: extraDays(25, [0, 4]) }, // 2
  { ref: 'DEMO-LINK-SAV-0001', type: 'DEBIT', category: 'Transfer', merchant: 'Credit card bill payment', baseMajor: 15000, spreadMajor: 3000, slots: everyMonth([CC_BILL_DAY]), mirrorOf: 'DEMO-LINK-CC-0005' }, // 6 (mirror)
  // --- debits from current ---
  { ref: 'DEMO-LINK-CUR-0002', type: 'DEBIT', category: 'Transport', merchant: 'Demo Cab Rides', baseMajor: 900, spreadMajor: 450, slots: everyMonth([1, 8, 15]) }, // 18
  { ref: 'DEMO-LINK-CUR-0002', type: 'DEBIT', category: 'Travel', merchant: 'Demo Travels Booking', baseMajor: 18500, spreadMajor: 5000, slots: everyMonth([14]) }, // 6
  // --- debits from credit card ---
  { ref: 'DEMO-LINK-CC-0005', type: 'DEBIT', category: 'Shopping', merchant: 'Demo Online Shopping', baseMajor: 4500, spreadMajor: 2200, slots: everyMonth([6, 19]) }, // 12
  { ref: 'DEMO-LINK-CC-0005', type: 'DEBIT', category: 'Subscriptions', merchant: 'Demo Streaming Subscription', baseMajor: 649, spreadMajor: 0, slots: everyMonth([8]) }, // 6
  { ref: 'DEMO-LINK-CC-0005', type: 'DEBIT', category: 'Entertainment', merchant: 'Demo Cinemas', baseMajor: 1250, spreadMajor: 600, slots: everyMonth([16]) }, // 6
  { ref: 'DEMO-LINK-CC-0005', type: 'DEBIT', category: 'Healthcare', merchant: 'Demo Pharmacy', baseMajor: 2100, spreadMajor: 900, slots: everyMonth([11]) }, // 6
  { ref: 'DEMO-LINK-CC-0005', type: 'DEBIT', category: 'Transport', merchant: 'Demo Fuel Station', baseMajor: 3200, spreadMajor: 400, slots: everyMonth([3]) }, // 6
];

export const DEMO_TRANSACTION_COUNT = 180;

/**
 * Deterministically generate the demo transactions.
 * Returns entries sorted chronologically with ids DEMO-TXN-0001…DEMO-TXN-0180.
 */
export function generateDemoTransactions() {
  const rng = demoRng();
  const raw = [];
  const mirrorAmounts = new Map(); // `${m}:${d}` → amount (bill-payment pair shares rng draw)

  for (const tpl of TXN_PLAN) {
    for (const slot of tpl.slots) {
      let amountMajor;
      if (tpl.mirrorOf && mirrorAmounts.has(`${slot.m}:${slot.d}`)) {
        amountMajor = mirrorAmounts.get(`${slot.m}:${slot.d}`);
      } else {
        amountMajor = tpl.baseMajor + Math.floor(rng() * (tpl.spreadMajor + 1));
        if (!tpl.mirrorOf && tpl.ref === 'DEMO-LINK-CC-0005' && tpl.category === 'Transfer') {
          mirrorAmounts.set(`${slot.m}:${slot.d}`, amountMajor);
        }
      }
      const hour = 8 + Math.floor(rng() * 12);
      const minute = Math.floor(rng() * 60);
      raw.push({
        accountLinkRef: tpl.ref,
        transactionType: tpl.type,
        amountMinor: r(amountMajor),
        narration: `${tpl.merchant} (synthetic demo)`,
        transactionDateTime: demoDate(slot.m, slot.d, hour, minute),
        category: tpl.category,
        source: 'DEMO',
        synthetic: true,
      });
    }
  }

  raw.sort((a, b) => (a.transactionDateTime < b.transactionDateTime ? -1 : a.transactionDateTime > b.transactionDateTime ? 1 : 0));
  return raw.map((t, i) => ({ txnId: `DEMO-TXN-${pad4(i + 1)}`, ...t }));
}

/** Σ credits / Σ debits per account link ref (minor units). */
export function demoCashFlows(transactions = generateDemoTransactions()) {
  const flows = new Map();
  for (const t of transactions) {
    if (!flows.has(t.accountLinkRef)) flows.set(t.accountLinkRef, { credits: 0, debits: 0 });
    const f = flows.get(t.accountLinkRef);
    if (t.transactionType === 'CREDIT') f.credits += t.amountMinor;
    else f.debits += t.amountMinor;
  }
  return flows;
}

/**
 * Build the 7 deterministic demo accounts. Closing balances are DERIVED:
 *   closing = opening + credits − debits   (liabilities carry a signed balance,
 *   following the mock convention that a credit card owes −|balance|; the
 *   normalizer converts to a positive liability with Math.abs).
 */
export function buildDemoAccounts(transactions = generateDemoTransactions()) {
  const flows = demoCashFlows(transactions);
  return DEMO_ACCOUNT_DEFS.map((def) => {
    const opening = r(def.openingMajor);
    const f = flows.get(def.linkRefNumber) || { credits: 0, debits: 0 };
    const closing = opening + f.credits - f.debits;
    return {
      fipId: def.fipId,
      linkRefNumber: def.linkRefNumber,
      maskedAccNumber: def.maskedAccNumber,
      accountType: def.accountType,
      name: def.name,
      currency: 'INR',
      openingBalanceMinor: opening,
      currentBalanceMinor: closing,
      balanceDateTime: `${DEMO_HISTORY.to}T23:59:00.000Z`,
      isLiability: Boolean(def.isLiability),
      source: 'DEMO',
      synthetic: true,
    };
  });
}

// ---------------------------------------------------------------------------
// 12 deterministic investment holdings (all synthetic securities).
// marketValueMinor per holding = quantity × priceMinor (computed by the engine,
// never hard-coded here; the builder below keeps price as the only input).
// ---------------------------------------------------------------------------
export const DEMO_HOLDINGS = Object.freeze([
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Reliance Industries (synthetic)', ticker: 'DRLI', assetClass: 'equity', currency: 'INR', quantity: '10', priceMinor: 295000, costBasisTotalMinor: 2450000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo HDFC Bank (synthetic)', ticker: 'DHDB', assetClass: 'equity', currency: 'INR', quantity: '20', priceMinor: 168000, costBasisTotalMinor: 3200000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo TCS (synthetic)', ticker: 'DTCS', assetClass: 'equity', currency: 'INR', quantity: '8', priceMinor: 410000, costBasisTotalMinor: 2960000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Infosys (synthetic)', ticker: 'DINF', assetClass: 'equity', currency: 'INR', quantity: '12', priceMinor: 152000, costBasisTotalMinor: 1632000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Nifty 50 Index Fund (synthetic)', ticker: 'DNF50', assetClass: 'mutual_fund', currency: 'INR', quantity: '120', priceMinor: 24500, costBasisTotalMinor: 2400000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Bluechip Fund (synthetic)', ticker: 'DBLUE', assetClass: 'mutual_fund', currency: 'INR', quantity: '80', priceMinor: 72000, costBasisTotalMinor: 5120000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Tech Fund (synthetic)', ticker: 'DTECH', assetClass: 'mutual_fund', currency: 'INR', quantity: '60', priceMinor: 98000, costBasisTotalMinor: 5220000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Nasdaq 100 ETF (synthetic)', ticker: 'DN100', assetClass: 'etf', currency: 'INR', quantity: '25', priceMinor: 145000, costBasisTotalMinor: 3012500 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Gold ETF (synthetic)', ticker: 'DGLD', assetClass: 'gold', currency: 'INR', quantity: '15', priceMinor: 69000, costBasisTotalMinor: 960000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Sovereign Gold Bond 2028 (synthetic)', ticker: 'DSGB28', assetClass: 'gold', currency: 'INR', quantity: '2', priceMinor: 685000, costBasisTotalMinor: 1210000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Silver ETF (synthetic)', ticker: 'DSLV', assetClass: 'silver', currency: 'INR', quantity: '30', priceMinor: 8200, costBasisTotalMinor: 201000 },
  { accountLinkRef: 'DEMO-LINK-BRK-0004', securityName: 'Demo Bharat Bond ETF (synthetic)', ticker: 'DBBND', assetClass: 'bond', currency: 'INR', quantity: '40', priceMinor: 125000, costBasisTotalMinor: 4760000 },
].map((h) => ({ ...h, source: 'DEMO', synthetic: true })));

// ---------------------------------------------------------------------------
// Retirement assets (EPF / PPF / NPS), insurance records, demo goals & budgets.
// Persisted by the demo loader outside the AA account pipeline, still fully
// deterministic and clearly synthetic.
// ---------------------------------------------------------------------------
export const DEMO_RETIREMENT = Object.freeze([
  { externalRef: 'DEMO-RETIREMENT-EPF', accountLinkRef: 'DEMO-LINK-RET-0008', instrumentType: 'EPF', name: 'Demo Employees Provident Fund (synthetic)', currency: 'INR', currentBalanceMinor: r(320000), maskedAccNumber: 'XXXXXX7550', source: 'DEMO', synthetic: true },
  { externalRef: 'DEMO-RETIREMENT-PPF', accountLinkRef: 'DEMO-LINK-RET-0009', instrumentType: 'PPF', name: 'Demo Public Provident Fund (synthetic)', currency: 'INR', currentBalanceMinor: r(180000), maskedAccNumber: 'XXXXXX7660', source: 'DEMO', synthetic: true },
  { externalRef: 'DEMO-RETIREMENT-NPS', accountLinkRef: 'DEMO-LINK-RET-0010', instrumentType: 'NPS', name: 'Demo National Pension System (synthetic)', currency: 'INR', currentBalanceMinor: r(96000), maskedAccNumber: 'XXXXXX7770', source: 'DEMO', synthetic: true },
]);

export const DEMO_INSURANCE = Object.freeze([
  { externalRef: 'DEMO-INSURANCE-LIFE', accountLinkRef: 'DEMO-LINK-INS-0011', policyType: 'LIFE', name: 'Demo Term Life Insurance (synthetic)', currency: 'INR', sumAssuredMinor: r(10000000), premiumMinor: r(12000), cashValueMinor: 0, maskedAccNumber: 'XXXXXX8110', source: 'DEMO', synthetic: true },
  { externalRef: 'DEMO-INSURANCE-HEALTH', accountLinkRef: 'DEMO-LINK-INS-0012', policyType: 'HEALTH', name: 'Demo Health Insurance — Family (synthetic)', currency: 'INR', sumAssuredMinor: r(1000000), premiumMinor: r(24000), cashValueMinor: 0, maskedAccNumber: 'XXXXXX8220', source: 'DEMO', synthetic: true },
  { externalRef: 'DEMO-INSURANCE-ULIP', accountLinkRef: 'DEMO-LINK-INS-0013', policyType: 'ULIP', name: 'Demo ULIP Endowment (synthetic)', currency: 'INR', sumAssuredMinor: r(2500000), premiumMinor: r(48000), cashValueMinor: r(340000), maskedAccNumber: 'XXXXXX8330', source: 'DEMO', synthetic: true },
]);

export const DEMO_GOALS = Object.freeze([
  { externalRef: 'DEMO-GOAL-0001', name: 'Emergency Fund', targetMinor: r(600000), currentMinor: r(320000), deadline: '2027-03-31' },
  { externalRef: 'DEMO-GOAL-0002', name: 'Retirement Corpus', targetMinor: r(80000000), currentMinor: r(33600000), deadline: '2046-03-31' },
  { externalRef: 'DEMO-GOAL-0003', name: 'Child Education', targetMinor: r(2500000), currentMinor: r(480000), deadline: '2035-06-30' },
  { externalRef: 'DEMO-GOAL-0004', name: 'Europe Trip', targetMinor: r(450000), currentMinor: r(120000), deadline: '2027-09-30' },
  { externalRef: 'DEMO-GOAL-0005', name: 'Home Down Payment', targetMinor: r(4000000), currentMinor: r(850000), deadline: '2029-12-31' },
  { externalRef: 'DEMO-GOAL-0006', name: 'New Car', targetMinor: r(900000), currentMinor: r(210000), deadline: '2028-06-30' },
].map((g) => ({ ...g, currency: 'INR', source: 'DEMO', synthetic: true })));

export const DEMO_BUDGETS = Object.freeze([
  { externalRef: 'DEMO-BUDGET-0001', categoryName: 'Food', amountMinor: r(15000) },
  { externalRef: 'DEMO-BUDGET-0002', categoryName: 'Transport', amountMinor: r(8000) },
  { externalRef: 'DEMO-BUDGET-0003', categoryName: 'Utilities', amountMinor: r(10000) },
  { externalRef: 'DEMO-BUDGET-0004', categoryName: 'Shopping', amountMinor: r(12000) },
].map((b) => ({ ...b, currency: 'INR', source: 'DEMO', synthetic: true })));

/**
 * Assemble the complete canonical demo FinancialData envelope
 * (ReBIT-adjacent shape consumed by the provider-neutral normalizer).
 * Pure function of DEMO_SEED → identical output on every call.
 */
export function buildDemoFinancialData() {
  const transactions = generateDemoTransactions();
  return {
    provider: 'demo',
    source: 'DEMO',
    synthetic: true,
    seed: DEMO_SEED,
    generatedFrom: { from: DEMO_HISTORY.from, to: DEMO_HISTORY.to },
    fips: DEMO_FIPS,
    accounts: buildDemoAccounts(transactions),
    holdings: DEMO_HOLDINGS,
    retirement: DEMO_RETIREMENT,
    insurance: DEMO_INSURANCE,
    goals: DEMO_GOALS,
    budgets: DEMO_BUDGETS,
    transactions,
  };
}

// Build-time self-check: the plan must always yield exactly 180 transactions
// and every generated cash account must end with a sane (non-negative-asset)
// closing balance. This throws at import time if the plan ever drifts.
(() => {
  const txns = generateDemoTransactions();
  if (txns.length !== DEMO_TRANSACTION_COUNT) {
    throw new Error(`Demo fixture self-check failed: expected ${DEMO_TRANSACTION_COUNT} transactions, plan produced ${txns.length}`);
  }
  for (const a of buildDemoAccounts(txns)) {
    if (!a.isLiability && a.currentBalanceMinor < 0) {
      throw new Error(`Demo fixture self-check failed: asset account ${a.linkRefNumber} closed negative (${a.currentBalanceMinor})`);
    }
  }
})();

export default {
  DEMO_SEED,
  DEMO_HISTORY,
  DEMO_FIPS,
  DEMO_ACCOUNT_DEFS,
  DEMO_TRANSACTION_COUNT,
  DEMO_HOLDINGS,
  DEMO_RETIREMENT,
  DEMO_INSURANCE,
  DEMO_GOALS,
  DEMO_BUDGETS,
  demoRng,
  generateDemoTransactions,
  demoCashFlows,
  buildDemoAccounts,
  buildDemoFinancialData,
};
