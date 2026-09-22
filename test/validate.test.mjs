// Length caps in src/lib/validate.ts: each input is rejected one character over its limit,
// before any decoding. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { parseReference, parseWalletAddress, parseSignature, parseAmountUsdc } = loadTs('src/lib/validate.ts');

const over = (limit) => '1'.repeat(limit + 1);

test('parseReference rejects 45 characters', () => {
  assert.throws(() => parseReference(over(44), 'reference'), { reason: 'reference is not a valid public key' });
});

test('parseWalletAddress rejects 45 characters', () => {
  assert.throws(() => parseWalletAddress(over(44), 'payer'), { reason: 'payer is not a valid public key' });
});

test('parseSignature rejects 89 characters', () => {
  assert.throws(() => parseSignature(over(88)), { reason: 'signature is not 64 bytes' });
});

test('parseAmountUsdc rejects 17 characters', () => {
  assert.throws(() => parseAmountUsdc(over(16)), { reason: 'amountUsdc must be a decimal with at most 6 decimals' });
});
