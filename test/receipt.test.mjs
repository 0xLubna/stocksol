// Tests for src/lib/receipt.ts on getParsedTransaction-shaped token balances. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { buildReceipt, balanceChange } = loadTs('src/lib/receipt.ts');

const PAYER = 'payer';
const RECIPIENT = 'recipient';
const HOLDING = 'holdingMint';
const USDCM = 'usdcMint';
const MULTIPLIER = 1.005714560286254;
const bal = (accountIndex, owner, mint, amount) => ({ accountIndex, owner, mint, uiTokenAmount: { amount: String(amount) } });

const base = { payer: PAYER, recipient: RECIPIENT, holdingMint: HOLDING, usdcMint: USDCM, amountUsdc: 1000000n, holdingDecimals: 8, multiplier: MULTIPLIER };

// Single path: one transaction sells 130,241 raw of the holding, the payer's USDC goes from
// 2,000,000 to 2,005,694 (the sale produced 1,005,694 and 1,000,000 was paid), the recipient's
// USDC account is created in the transaction (no pre-balance).
const single = {
  meta: {
    fee: 5409,
    preTokenBalances: [bal(1, PAYER, HOLDING, 4521495), bal(2, PAYER, USDCM, 2000000)],
    postTokenBalances: [bal(1, PAYER, HOLDING, 4391254), bal(2, PAYER, USDCM, 2005694), bal(3, RECIPIENT, USDCM, 1000000)],
  },
};

test('single path receipt', () => {
  const r = buildReceipt({ ...base, transactions: [single], single: true });
  assert.equal(r.sold, 130241n);
  assert.equal(r.got, 1005694n);
  assert.equal(r.paid, 1000000n);
  assert.equal(r.kept, 5694n);
  assert.equal(r.fees, 5409n);
  const expectedPrice = 1.005694 / ((130241 / 1e8) * MULTIPLIER);
  assert.ok(Math.abs(Number(r.pricePerUnit) - expectedPrice) < 0.01, `${r.pricePerUnit} vs ${expectedPrice}`);
});

// Split path: the sale transaction produces 1,005,694 USDC; the payment transaction moves
// 1,000,000 to the recipient's new account.
const sale = {
  meta: {
    fee: 5409,
    preTokenBalances: [bal(1, PAYER, HOLDING, 4521495), bal(2, PAYER, USDCM, 2000000)],
    postTokenBalances: [bal(1, PAYER, HOLDING, 4391254), bal(2, PAYER, USDCM, 3005694)],
  },
};
const payment = {
  meta: {
    fee: 5014,
    preTokenBalances: [bal(1, PAYER, USDCM, 3005694)],
    postTokenBalances: [bal(1, PAYER, USDCM, 2005694), bal(2, RECIPIENT, USDCM, 1000000)],
  },
};

test('split path receipt', () => {
  const r = buildReceipt({ ...base, transactions: [sale, payment], single: false });
  assert.equal(r.sold, 130241n);
  assert.equal(r.got, 1005694n);
  assert.equal(r.paid, 1000000n);
  assert.equal(r.kept, 5694n);
  assert.equal(r.fees, 10423n);
  assert.equal(r.pricePerUnit, buildReceipt({ ...base, transactions: [single], single: true }).pricePerUnit);
});

test('a missing pre-balance counts as zero', () => {
  const noPre = {
    meta: {
      fee: 5409,
      preTokenBalances: [bal(1, PAYER, HOLDING, 4521495)],
      postTokenBalances: [bal(1, PAYER, HOLDING, 4391254), bal(2, PAYER, USDCM, 5694), bal(3, RECIPIENT, USDCM, 1000000)],
    },
  };
  const r = buildReceipt({ ...base, transactions: [noPre], single: true });
  assert.equal(r.got, 1005694n);
  assert.equal(r.paid, 1000000n);
  assert.equal(r.kept, 5694n);
  assert.equal(balanceChange(noPre, PAYER, USDCM), 5694n);
  assert.equal(balanceChange(noPre, RECIPIENT, USDCM), 1000000n);
});

test('a missing post-balance counts as zero and nothing sold gives no price', () => {
  const closed = { meta: { fee: 5000, preTokenBalances: [bal(1, PAYER, USDCM, 7)], postTokenBalances: [] } };
  assert.equal(balanceChange(closed, PAYER, USDCM), -7n);
  const r = buildReceipt({ ...base, transactions: [closed], single: true });
  assert.equal(r.sold, 0n);
  assert.equal(r.pricePerUnit, null);
});
