// WealthCore — provider-neutral ReBIT normalizer.
//
// Raw provider data → provider adapter → canonical envelope → this normalizer
// → WealthCore domain rows (accounts / transactions / holdings). WealthCore's
// financial logic never depends on a provider's raw format.
//
// The canonical envelope fields are deliberately simple and provider-agnostic:
//   { fips[], accounts[], holdings[], retirement[], insurance[], transactions[], loans[] }
//
// A real provider adapter (setu/finvu/onemoney) translates its own payload into
// this envelope before normalization. The Mock adapter returns it directly.

import { aaError, AA_ERROR_CODES } from './errors.js';

const TYPE_TO_ACCOUNT = {
  SAVINGS: 'savings',
  CURRENT: 'current',
  CREDIT_CARD: 'credit',
  TERM_DEPOSIT: 'fd',
  RECURRING_DEPOSIT: 'fd',
  BROKERAGE: 'brokerage',
  MUTUAL_FUNDS: 'mutual_fund',
  EQUITIES: 'brokerage',
  LOAN: 'loan',
  INSURANCE: 'insurance',
};

const CATEGORY_SPEND_KIND = {
  Housing: 'expense', Food: 'expense', Transport: 'expense', Utilities: 'expense',
  Shopping: 'expense', Entertainment: 'expense', Insurance: 'expense',
  'EMI/Debt': 'expense', Subscriptions: 'expense', Travel: 'expense',
  Healthcare: 'expense', Education: 'expense', Other: 'expense',
  Salary: 'income', Investments: 'savings', Transfer: 'transfer',
};

function normalizeDate(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw).slice(0, 10) : d.toISOString().slice(0, 10);
}

const toMinor = (n) => Math.round(Number(n || 0));

export function normalizeAccount(acct) {
  // A provider may report a liability as a negative balance (e.g. credit card
  // "amount owing" is negative). WealthCore's net-worth model stores the amount
  // owed as a POSITIVE liability, so normalise sign away for liabilities.
  const rawBalance = toMinor(acct.currentBalanceMinor);
  const balanceMinor = acct.isLiability ? Math.abs(rawBalance) : rawBalance;
  return {
    external_ref: acct.linkRefNumber || acct.accountId || acct.maskedAccNumber,
    fip: acct.fipId || null,
    name: acct.name || acct.accountType || 'Linked Account',
    type: TYPE_TO_ACCOUNT[acct.accountType] || 'other',
    currency: acct.currency || 'INR',
    balanceMinor,
    isLiability: !!acct.isLiability,
    maskedAccountNumber: acct.maskedAccNumber || null,
    balanceDateTime: acct.balanceDateTime || null,
    accountType: acct.accountType || null,
    linkRefNumber: acct.linkRefNumber || null,
  };
}

export function normalizeTransaction(tx, accountByLinkRef) {
  if (!tx.txnId && (tx.amountMinor == null || !tx.transactionDateTime)) {
    throw aaError(AA_ERROR_CODES.INVALID_PAYLOAD, 'Transaction missing id/amount/date', {});
  }
  const direction = String(tx.transactionType || tx.type || '').toUpperCase() === 'CREDIT' ? 'in' : 'out';
  const category = tx.category || null;
  const kind = CATEGORY_SPEND_KIND[category] || (direction === 'in' ? 'income' : 'expense');
  const acctRef = accountByLinkRef.get(tx.accountLinkRef) || null;
  return {
    sourceTxnId: tx.txnId || null,
    date: normalizeDate(tx.transactionDateTime || tx.date),
    amountMinor: toMinor(tx.amountMinor),
    direction,
    kind,
    merchant: tx.narration || tx.description || null,
    category,
    accountExternalRef: acctRef ? (acctRef.linkRefNumber || acctRef.external_ref || acctRef.maskedAccNumber) : null,
    accountId: acctRef ? acctRef.dbId : null,
    fip: acctRef ? (acctRef.fipId || acctRef.fip) : null,
  };
}

export function normalizeHolding(holding) {
  return {
    accountExternalRef: holding.accountLinkRef || null,
    securityName: holding.securityName,
    ticker: holding.ticker || null,
    assetClass: holding.assetClass || 'equity',
    currency: holding.currency || 'INR',
    quantity: String(holding.quantity),
    priceMinor: holding.priceMinor != null ? toMinor(holding.priceMinor) : null,
    costBasisTotalMinor: toMinor(holding.costBasisTotalMinor),
  };
}

/** Normalize a full canonical envelope into domain-ready rows. */
export function normalizeFinancialData(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw aaError(AA_ERROR_CODES.INVALID_PAYLOAD, 'Invalid financial data envelope', {});
  }

  const accounts = (envelope.accounts || []).map(normalizeAccount);
  const accountByLinkRef = new Map();
  for (const a of envelope.accounts || []) {
    if (a.linkRefNumber) accountByLinkRef.set(a.linkRefNumber, a);
  }

  const transactions = (envelope.transactions || []).map((tx) => normalizeTransaction(tx, accountByLinkRef));
  const holdings = (envelope.holdings || []).map(normalizeHolding);

  return {
    provider: envelope.provider || 'unknown',
    fips: envelope.fips || [],
    accounts,
    transactions,
    holdings,
    retirement: envelope.retirement || [],
    insurance: envelope.insurance || [],
    loans: envelope.loans || [],
  };
}

/** Capability error for unsupported FI types (never silently drop). */
export function capabilityError(fiType) {
  return aaError(AA_ERROR_CODES.UNSUPPORTED_FI_TYPE, `FI type "${fiType}" is not supported by this provider.`, { fiType });
}

export default normalizeFinancialData;
