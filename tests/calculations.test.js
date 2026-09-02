// Deterministic financial-calculation tests.
// Expected values were independently computed in Python (see docs/TEST_CASES.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emi, cagr, sipFutureValue, fdMaturity, xirr, amortization,
  savingsRate, debtRatio, futureValue,
} from '../server/lib/calculations.js';

test('EMI is accurate for 5L @8.5% for 20 years', () => {
  // Python: 4339.1162
  assert.ok(Math.abs(emi(500000, 0.085, 240) - 4339.1162) < 0.001);
});

test('EMI for zero interest equals principal/months', () => {
  assert.ok(Math.abs(emi(120000, 0, 12) - 10000) < 0.001);
});

test('Amortization schedule ends at a zero balance and total years consistent', () => {
  const { emi, schedule, totalInterest } = amortization(200000, 0.09, 12);
  assert.ok(Math.abs(emi - 17490.2954) < 0.01);
  assert.equal(schedule.length, 12);
  assert.ok(Math.abs(schedule[schedule.length - 1].balance) < 0.01);
  // Total paid minus principal = interest (tolerance covers per-row EMI rounding)
  const totalPaid = schedule.reduce((a, s) => a + s.emi, 0);
  assert.ok(Math.abs(totalPaid - 200000 - totalInterest) < 0.2);
  // Principal payments must sum to the loan amount.
  const principalPaid = schedule.reduce((a, s) => a + s.principal, 0);
  assert.ok(Math.abs(principalPaid - 200000) < 0.2);
});

test('SIP future value (annuity due) matches reference', () => {
  // Python: start-of-period 128093.28
  assert.ok(Math.abs(sipFutureValue(10000, 0.12, 12, true) - 128093.28) < 0.01);
  // Python: end-of-period 126825.03
  assert.ok(Math.abs(sipFutureValue(10000, 0.12, 12, false) - 126825.03) < 0.01);
});

test('FD maturity (quarterly compounding) matches reference', () => {
  // Python: 138041.98
  assert.ok(Math.abs(fdMaturity(100000, 0.065, 4, 5) - 138041.98) < 0.01);
});

test('CAGR matches reference', () => {
  // Python: 14.471424%
  assert.ok(Math.abs(cagr(100000, 150000, 3) - 0.14471424) < 1e-6);
});

test('XIRR matches reference', () => {
  // Python: -1000 on 2020-01-01, +1500 on 2021-01-01 => 49.833918%
  const r = xirr([{ date: '2020-01-01', amount: -1000 }, { date: '2021-01-01', amount: 1500 }]);
  assert.ok(Math.abs(r - 0.49833918) < 1e-4);
});

test('Savings rate correctly computed', () => {
  // income 100, expense 60 => 0.4
  assert.ok(Math.abs(savingsRate(100, 60) - 0.4) < 1e-9);
  assert.throws(() => savingsRate(0, 0));
});

test('Debt ratio', () => {
  assert.ok(Math.abs(debtRatio(50, 200) - 0.25) < 1e-9);
  assert.equal(debtRatio(10, 0), 0);
});

test('Future (inflation-adjusted) value', () => {
  // Python: 100000 @6% over 10y => 55839.48
  assert.ok(Math.abs(futureValue(100000, 0.06, 10) - 55839.48) < 0.01);
});
