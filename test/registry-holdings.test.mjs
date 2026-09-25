// Tests for src/registry.ts: the payable list and the lookups for the offered holdings.
// Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const { payableHoldings, isPayableHoldingMint, findHolding } = loadTs('src/registry.ts');

const NVDAX = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const TSLAX = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';

test('payableHoldings returns SPYx, NVDAx, TSLAx in that order', () => {
  assert.deepEqual(
    payableHoldings().map((h) => h.symbol),
    ['SPYx', 'NVDAx', 'TSLAx'],
  );
});

test('isPayableHoldingMint is true for both new mints and false for a synthetic key', () => {
  assert.equal(isPayableHoldingMint(NVDAX), true);
  assert.equal(isPayableHoldingMint(TSLAX), true);
  assert.equal(isPayableHoldingMint(web3.Keypair.generate().publicKey.toBase58()), false);
});

test('findHolding gives decimals 8 for each new mint', () => {
  assert.equal(findHolding(NVDAX).decimals, 8);
  assert.equal(findHolding(TSLAX).decimals, 8);
});
