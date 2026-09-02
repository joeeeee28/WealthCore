// Money / decimal arithmetic tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMinor, toMajor, format, add, sub, scale, pct,
} from '../server/lib/money.js';

test('parseMinor converts decimal strings to integer minor units', () => {
  assert.equal(parseMinor('250000'), 25000000);
  assert.equal(parseMinor('248500.50'), 24850050);
  assert.equal(parseMinor('-1,200.75'), -120075);
  assert.equal(parseMinor('0'), 0);
});

test('parseMinor handles number input', () => {
  assert.equal(parseMinor(1000), 100000);
});

test('parseMinor rejects malformed input', () => {
  assert.throws(() => parseMinor('abc'));
  assert.throws(() => parseMinor('12x3'));
  assert.throws(() => parseMinor('1.2.3'));
});

test('toMajor reverses parseMinor', () => {
  assert.equal(toMajor(parseMinor('250000.50')), 250000.5);
});

test('add/sub preserve integer minor units', () => {
  assert.equal(add(100, 200), 300);
  assert.equal(sub(100, 250), -150);
});

test('scale and pct round to integer minor units', () => {
  assert.equal(scale(10000, 1.5), 15000);
  assert.equal(pct(200000, 10), 20000);
});

test('format uses Indian lakh/crore grouping and symbols', () => {
  assert.equal(format(2080000000, 'INR'), '₹2.08 Cr');
  assert.equal(format(24850000, 'INR'), '₹2.48L');
  assert.equal(format(1500000000, 'INR'), '₹1.50 Cr'); // 1.5 Cr = 1,500,000,000 minor
  assert.equal(format(100000, 'INR'), '₹1,000.00');
  assert.equal(format(-120075, 'INR'), '₹-1,200.75');
});
