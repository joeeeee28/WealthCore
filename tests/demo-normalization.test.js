// Demo data normalization tests.
//
// Verifies the provider-neutral ReBIT normalizer maps the deterministic demo
// envelope into WealthCore domain rows correctly (accounts, transactions,
// holdings — with liability sign handling, direction/kind mapping and link-ref
// accounting), and that fixture generation is deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFinancialData } from '../server/aa/rebit-normalizer.js';
import {
  buildDemoFinancialData, generateDemoTransactions, buildDemoAccounts,
  DEMO_TRANSACTION_COUNT, DEMO_HOLDINGS, DEMO_RETIREMENT, DEMO_INSURANCE, DEMO_GOALS, DEMO_SEED,
} from '../server/aa/fixtures/demo-data.js';

test('demo fixture generation is fully deterministic (same seed → same bytes)', () => {
  const a = buildDemoFinancialData();
  const b = buildDemoFinancialData();
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'two builds must be byte-identical');

  const t1 = generateDemoTransactions();
  const t2 = generateDemoTransactions();
  assert.equal(JSON.stringify(t1), JSON.stringify(t2));
  assert.ok(DEMO_SEED, 'seed is explicit');
});

test('demo fixture targets: 7 accounts, 12 holdings, retirement, insurance, 2 loans, 6 goals, 180 txns, ~6 months', () => {
  const env = buildDemoFinancialData();
  assert.equal(env.accounts.length, 7);
  assert.equal(env.holdings.length, 12);
  assert.equal(env.retirement.length, 3);
  assert.ok(env.retirement.some((r) => r.instrumentType === 'EPF'));
  assert.ok(env.retirement.some((r) => r.instrumentType === 'PPF'));
  assert.ok(env.retirement.some((r) => r.instrumentType === 'NPS'));
  assert.equal(env.insurance.length, 3);
  assert.equal(env.goals.length, 6);
  assert.equal(env.transactions.length, 180);
  const loans = env.accounts.filter((a) => a.isLiability);
  assert.equal(loans.length, 2, 'exactly 2 loans/liabilities (credit card + home loan)');

  // History spans several months (April → September 2026).
  const dates = env.transactions.map((t) => t.transactionDateTime.slice(0, 7));
  const months = new Set(dates);
  assert.ok(months.size >= 5, `expected ≥5 distinct months, got ${months.size}`);
  const sorted = [...dates].sort();
  assert.equal(sorted[0], '2026-04');
  assert.equal(sorted[sorted.length - 1], '2026-09');
});

test('normalizer maps all demo accounts with correct types and refs', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  assert.equal(norm.accounts.length, env.accounts.length);

  const byRef = new Map(norm.accounts.map((a) => [a.external_ref, a]));
  for (const raw of env.accounts) {
    const n = byRef.get(raw.linkRefNumber);
    assert.ok(n, `normalized account for ${raw.linkRefNumber}`);
    assert.equal(n.currency, 'INR');
    assert.equal(n.maskedAccountNumber, raw.maskedAccNumber);
  }
  assert.equal(byRef.get('DEMO-LINK-SAV-0001').type, 'savings');
  assert.equal(byRef.get('DEMO-LINK-CUR-0002').type, 'current');
  assert.equal(byRef.get('DEMO-LINK-FD-0003').type, 'fd');
  assert.equal(byRef.get('DEMO-LINK-RD-0007').type, 'fd');
  assert.equal(byRef.get('DEMO-LINK-BRK-0004').type, 'brokerage');
  assert.equal(byRef.get('DEMO-LINK-CC-0005').type, 'credit');
  assert.equal(byRef.get('DEMO-LINK-HL-0006').type, 'loan');
});

test('liability normalization: amounts owed are stored positive', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  const byRef = new Map(norm.accounts.map((a) => [a.external_ref, a]));

  const cc = byRef.get('DEMO-LINK-CC-0005');
  assert.equal(cc.isLiability, true);
  assert.ok(cc.balanceMinor > 0, 'credit-card owed amount stored positive');
  assert.equal(cc.balanceMinor, Math.abs(env.accounts.find((a) => a.linkRefNumber === 'DEMO-LINK-CC-0005').currentBalanceMinor));

  const hl = byRef.get('DEMO-LINK-HL-0006');
  assert.equal(hl.isLiability, true);
  assert.ok(hl.balanceMinor > 0);

  const sav = byRef.get('DEMO-LINK-SAV-0001');
  assert.equal(sav.isLiability, false);
  assert.ok(sav.balanceMinor > 0);
});

test('transaction normalization: ids, direction, kind, category, dates', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  assert.equal(norm.transactions.length, DEMO_TRANSACTION_COUNT);

  const rawById = new Map(env.transactions.map((t) => [t.txnId, t]));
  for (const n of norm.transactions) {
    const raw = rawById.get(n.sourceTxnId);
    assert.ok(raw, 'normalized txn traces to a fixture txn');
    assert.match(n.sourceTxnId, /^DEMO-TXN-\d{4}$/);
    assert.equal(n.direction, raw.transactionType === 'CREDIT' ? 'in' : 'out');
    assert.equal(n.amountMinor, raw.amountMinor);
    assert.ok(Number.isInteger(n.amountMinor));
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(n.date, raw.transactionDateTime.slice(0, 10));
    assert.equal(n.category, raw.category);
    assert.ok(n.accountExternalRef, 'every demo txn binds to an account link ref');
  }

  const salary = norm.transactions.filter((t) => t.category === 'Salary');
  assert.equal(salary.length, 6);
  assert.ok(salary.every((t) => t.kind === 'income' && t.direction === 'in'));

  const rent = norm.transactions.filter((t) => t.category === 'Housing');
  assert.ok(rent.every((t) => t.kind === 'expense' && t.direction === 'out'));

  const sip = norm.transactions.filter((t) => t.category === 'Investments');
  assert.ok(sip.every((t) => t.kind === 'savings'));

  const transfers = norm.transactions.filter((t) => t.category === 'Transfer');
  assert.equal(transfers.length, 12, 'mirrored credit-card payment pair per month');
  assert.ok(transfers.every((t) => t.kind === 'transfer'));
});

test('all normalized transactions resolve to a normalized demo account', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  const refs = new Set(norm.accounts.map((a) => a.external_ref));
  for (const t of norm.transactions) {
    assert.ok(refs.has(t.accountExternalRef), `${t.sourceTxnId} → ${t.accountExternalRef}`);
  }
});

test('holding normalization preserves quantity/price/security identity', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  assert.equal(norm.holdings.length, DEMO_HOLDINGS.length);
  for (const n of norm.holdings) {
    const raw = DEMO_HOLDINGS.find((h) => h.securityName === n.securityName);
    assert.ok(raw);
    assert.equal(n.quantity, raw.quantity);
    assert.equal(n.priceMinor, raw.priceMinor);
    assert.equal(n.costBasisTotalMinor, raw.costBasisTotalMinor);
    assert.equal(n.accountExternalRef, raw.accountLinkRef);
  }
});

test('envelope passthrough sections (fips/retirement/insurance) preserved by the normalizer', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  assert.equal(norm.fips.length, 3);
  assert.equal(norm.retirement.length, DEMO_RETIREMENT.length);
  assert.equal(norm.insurance.length, DEMO_INSURANCE.length);
  assert.equal(norm.provider, 'demo');
  // Goals/budgets are demo-environment extras carried on the raw envelope and
  // persisted by the demo loader (outside the AA account pipeline).
  assert.equal(env.goals.length, DEMO_GOALS.length);
  assert.equal(env.budgets.length, 4);
});

test('normalized account set: opening + credits − debits = closing per account', () => {
  const env = buildDemoFinancialData();
  const norm = normalizeFinancialData(env);
  const rawAccounts = buildDemoAccounts(env.transactions);
  const rawByRef = new Map(rawAccounts.map((a) => [a.linkRefNumber, a]));
  for (const n of norm.accounts) {
    const raw = rawByRef.get(n.external_ref);
    const { openingBalanceMinor, currentBalanceMinor, isLiability } = raw;
    const credits = env.transactions.filter((t) => t.accountLinkRef === raw.linkRefNumber && t.transactionType === 'CREDIT').reduce((s, t) => s + t.amountMinor, 0);
    const debits = env.transactions.filter((t) => t.accountLinkRef === raw.linkRefNumber && t.transactionType === 'DEBIT').reduce((s, t) => s + t.amountMinor, 0);
    assert.equal(currentBalanceMinor, openingBalanceMinor + credits - debits, `${n.external_ref} balance identity`);
    const expected = isLiability ? Math.abs(currentBalanceMinor) : currentBalanceMinor;
    assert.equal(n.balanceMinor, expected);
  }
});
