// WealthCore — Transaction Intelligence.
//
// Deterministic, rule-based logic for:
//   * duplicate detection
//   * transfer detection
//   * merchant → category auto-categorization
//   * recurring-payment detection
//   * per-transaction validation
//
// It never guesses financial values. Categorization is keyword/heuristic based
// and always stored with the source (so the user can override).

import crypto from 'node:crypto';
import * as money from './money.js';

export const DEFAULT_CATEGORY_MAP = [
  { pattern: /grocery|grocer|bigbasket|dmart|reliance fresh|supermarket/i, category: 'Groceries', kind: 'expense', color: '#22c55e' },
  { pattern: /rent|landlord|housing/i, category: 'Rent', kind: 'expense', color: '#8b5cf6' },
  { pattern: /salary|payroll|employer|company salary/i, category: 'Salary', kind: 'income', color: '#3b82f6' },
  { pattern: /electric|electricity|power|tneb|bses/i, category: 'Utilities', kind: 'expense', color: '#f59e0b' },
  { pattern: /internet|broadband|wi-?fi|airtel|jio|act/i, category: 'Internet', kind: 'expense', color: '#06b6d4' },
  { pattern: /swiggy|zomato|dominos|pizza|restaurant|cafe|food/i, category: 'Dining', kind: 'expense', color: '#ef4444' },
  { pattern: /uber|ola|metro|fuel|petrol|indian oil|pump/i, category: 'Travel', kind: 'expense', color: '#f97316' },
  { pattern: /phone|mobile|recharge|vi|vodafone|jio/i, category: 'Mobile', kind: 'expense', color: '#14b8a6' },
  { pattern: /netflix|spotify|prime|hotstar|ott/i, category: 'Subscriptions', kind: 'expense', color: '#a855f7' },
  { pattern: /insurance|lic|hdfc life|policybazaar/i, category: 'Insurance', kind: 'expense', color: '#64748b' },
  { pattern: /fd |deposit|fixed deposit|recurring deposit|rd /i, category: 'Deposits', kind: 'savings', color: '#22c55e' },
  { pattern: /sip|mutual fund|mfs|index fund|elss/i, category: 'Mutual Funds', kind: 'investment', color: '#3b82f6' },
  { pattern: /emi|loan|credit card.*payment|car loan|home loan/i, category: 'EMI', kind: 'expense', color: '#ef4444' },
  { pattern: /interest|dividend|deposit interest/i, category: 'Interest', kind: 'income', color: '#22c55e' },
];

export function dedupKey({ accountId, date, amountMinor, direction, providerRef, externalId }) {
  const base = providerRef || externalId;
  if (base) {
    return crypto.createHash('sha256').update(`ref:${base}`).digest('hex').slice(0, 24);
  }
  const fields = [
    't', String(accountId || ''), String(date || ''), String(amountMinor), String(direction || ''),
  ].join('|');
  return crypto.createHash('sha256').update(fields).digest('hex').slice(0, 24);
}

export function validateTransaction(tx, { db, userId } = {}) {
  const errors = [];
  if (tx.amountMinor == null || Number.isNaN(Number(tx.amountMinor))) {
    errors.push('amount_minor must be a valid integer');
  } else if (Number(tx.amountMinor) <= 0) {
    // Zero/negative amounts are rejected as amounts; a refund is represented by
    // direction rather than a negative magnitude.
    errors.push('amount_minor must be > 0');
  }
  if (!tx.date || Number.isNaN(new Date(tx.date).getTime())) {
    errors.push('date must be a valid date');
  }
  if (tx.direction !== 'in' && tx.direction !== 'out') {
    errors.push("direction must be 'in' or 'out'");
  }
  if (!tx.currency || typeof tx.currency !== 'string') {
    errors.push('currency is required');
  }
  if (tx.accountId == null) {
    errors.push('account_id is required');
  } else if (db) {
    const acct = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(tx.accountId, userId);
    if (!acct) errors.push('account_id does not exist for this user');
  }
  if (tx.amountMinor != null && tx.amountMinor > 0 && tx.accountId != null && db) {
    const acct = db.prepare('SELECT balance_minor, is_liability, currency FROM accounts WHERE id = ?').get(tx.accountId);
    if (acct && acct.currency !== tx.currency) {
      errors.push(`currency mismatch: account is ${acct.currency} but transaction is ${tx.currency}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Detect whether the transaction is likely an internal transfer. */
export function detectTransfer(tx, otherTxns, { toleranceMinor = 0 } = {}) {
  // A transfer appears as matching 'in' and 'out' transactions of the same
  // magnitude on the same date across two different accounts.
  for (const other of otherTxns) {
    if (other.id === tx.id) continue;
    if (other.date !== tx.date) continue;
    if (other.direction === tx.direction) continue;
    if (Number(other.amount_minor) !== Number(tx.amount_minor)) continue;
    if (Number(other.account_id) === Number(tx.account_id)) continue;
    return { isTransfer: true, pairedTransactionId: other.id };
  }
  return { isTransfer: false };
}

/** Auto-categorize a merchant string to a category name + kind. */
export function categorize(merchant, note = '') {
  const haystack = `${merchant || ''} ${note || ''}`.trim();
  for (const rule of DEFAULT_CATEGORY_MAP) {
    if (rule.pattern.test(haystack)) {
      return { name: rule.category, kind: rule.kind, color: rule.color, confidence: 'high' };
    }
  }
  return { name: 'Uncategorized', kind: 'expense', color: '#94a3b8', confidence: 'low' };
}

/** Detect a recurring pattern: same merchant + amount appearing >= 2 distinct months. */
export function detectRecurring(txns, { minCount = 2 } = {}) {
  const groups = new Map(); // key -> { merchant, amountMinor, months:Set }
  for (const t of txns) {
    const merchant = String(t.merchant || '').trim() || '(empty)';
    const key = `${merchant.toLowerCase()}|${Number(t.amount_minor)}`;
    const month = String(t.date).slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, { merchant, amountMinor: Number(t.amount_minor), months: new Set() });
    }
    groups.get(key).months.add(month);
  }
  const recurringMerchants = [];
  for (const g of groups.values()) {
    if (g.months.size >= minCount) {
      recurringMerchants.push({
        merchant: g.merchant,
        amountMinor: g.amountMinor,
        months: g.months.size,
      });
    }
  }
  return recurringMerchants;
}

export default {
  DEFAULT_CATEGORY_MAP, dedupKey, validateTransaction, detectTransfer,
  categorize, detectRecurring,
};
