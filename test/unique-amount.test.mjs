// Tests for src/lib/unique-amount.ts. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { uniqueAmount, formatUsdc, drawUniqueStep, UNIQUE_MIN, UNIQUE_MAX } = loadTs('src/lib/unique-amount.ts');
const { parseAmountUsdc } = loadTs('src/lib/validate.ts');

test('adds k millionths and formats without trailing zeros', () => {
  assert.equal(uniqueAmount('2', 417), '2.000417');
  assert.equal(uniqueAmount('1.5', 1), '1.500001');
  assert.equal(uniqueAmount('0.1', 999), '0.100999');
  assert.equal(uniqueAmount('1.999999', 1), '2');
  assert.equal(parseAmountUsdc(uniqueAmount('2', 417)), 2_000_417n);
});

test('the result must pass the same amount rules and cap as /api/pay', () => {
  assert.throws(() => uniqueAmount('24.999999', 1), { reason: 'amountUsdc is above the cap' });
  assert.throws(() => uniqueAmount('24.9995', 500), { reason: 'amountUsdc is above the cap' });
  assert.equal(uniqueAmount('24.9995', 499), '24.999999');
  assert.throws(() => uniqueAmount('abc', 5), { reason: 'amountUsdc must be a decimal with at most 6 decimals' });
});

test('k outside 1 to 999 is refused', () => {
  assert.throws(() => uniqueAmount('2', 0), { reason: 'unique amount step out of range' });
  assert.throws(() => uniqueAmount('2', 1000), { reason: 'unique amount step out of range' });
  assert.throws(() => uniqueAmount('2', 1.5), { reason: 'unique amount step out of range' });
});

test('formatUsdc', () => {
  assert.equal(formatUsdc(0n), '0');
  assert.equal(formatUsdc(1n), '0.000001');
  assert.equal(formatUsdc(2_000_000n), '2');
  assert.equal(formatUsdc(2_000_417n), '2.000417');
});

test('drawUniqueStep stays within 1 to 999', () => {
  for (let i = 0; i < 1000; i += 1) {
    const k = drawUniqueStep();
    assert.ok(Number.isInteger(k) && k >= UNIQUE_MIN && k <= UNIQUE_MAX, String(k));
  }
});
