// Transaction intelligence (dedup, categorization, validation, transfer,
// recurring) tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupKey, categorize, validateTransaction, detectTransfer, detectRecurring,
} from '../server/lib/transaction-intelligence.js';

test('dedup key is stable and differs with amount/date', () => {
  const base = { accountId: 1, date: '2026-08-01', amountMinor: 1000, direction: 'out' };
  const k1 = dedupKey(base);
  assert.equal(k1, dedupKey(base));
  assert.notEqual(k1, dedupKey({ ...base, amountMinor: 1001 }));
  assert.notEqual(k1, dedupKey({ ...base, date: '2026-08-02' }));
  // provider ref overrides
  const withRef = dedupKey({ ...base, providerRef: 'ABC-123' });
  assert.equal(withRef, dedupKey({ ...base, providerRef: 'ABC-123' }));
  assert.notEqual(withRef, dedupKey({ ...base, providerRef: 'ABC-124' }));
});

test('categorizes merchants to known categories', () => {
  assert.equal(categorize('BigBasket Groceries').name, 'Groceries');
  assert.equal(categorize('ACME Corp Salary').name, 'Salary');
  assert.equal(categorize('Swiggy').name, 'Dining');
  assert.equal(categorize('Landlord Rent').name, 'Rent');
  assert.equal(categorize('Electricity Bill').name, 'Utilities');
  assert.equal(categorize('Random Unknown Merchant').name, 'Uncategorized');
});

test('validateTransaction flags structural errors', () => {
  const ok = validateTransaction({ amountMinor: 500, date: '2026-08-01', direction: 'out', currency: 'INR', accountId: 1 });
  assert.equal(ok.valid, true);

  const bad = validateTransaction({ amountMinor: -5, date: 'not-a-date', direction: 'x', currency: 'INR', accountId: 1 });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length >= 3);
});

test('validateTransaction rejects non-existent account', () => {
  const fakeDb = { prepare: () => ({ get: () => null }) };
  const r = validateTransaction({ amountMinor: 500, date: '2026-08-01', direction: 'out', currency: 'INR', accountId: 999 }, { db: fakeDb, userId: 1 });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('account_id')));
});

test('detectTransfer matches paired in/out transactions of same amount/date', () => {
  const t1 = { id: 1, date: '2026-08-01', direction: 'out', amount_minor: 5000, account_id: 1 };
  const t2 = { id: 2, date: '2026-08-01', direction: 'in', amount_minor: 5000, account_id: 2 };
  const t3 = { id: 3, date: '2026-08-01', direction: 'out', amount_minor: 9999, account_id: 1 };
  const d = detectTransfer(t1, [t1, t2, t3]);
  assert.equal(d.isTransfer, true);
  assert.equal(d.pairedTransactionId, 2);
  assert.equal(detectTransfer(t3, [t1, t2, t3]).isTransfer, false);
});

test('detectRecurring groups same merchant+amount across distinct months', () => {
  const txns = [
    { merchant: 'Rent', amount_minor: 180000, date: '2026-06-01' },
    { merchant: 'Rent', amount_minor: 180000, date: '2026-07-01' },
    { merchant: 'Rent', amount_minor: 180000, date: '2026-08-01' },
    { merchant: 'Swiggy', amount_minor: 50000, date: '2026-08-10' },
  ];
  const rec = detectRecurring(txns, { minCount: 2 });
  assert.equal(rec.length, 1);
  assert.equal(rec[0].merchant, 'Rent');
  assert.equal(rec[0].amountMinor, 180000);
});
