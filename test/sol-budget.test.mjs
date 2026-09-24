// Tests for src/lib/sol-budget.ts: the lamports a payment needs and the SOL shortage mapping.
// Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { lamportsRequired, transactionFee, lamportShortfall, payerOutflow, formatSol, solShortageReason, SIGNATURE_FEE_LAMPORTS } =
  loadTs('src/lib/sol-budget.ts');

// Literal values read on 23 Sep 2026: rent-exempt minimum for 0 bytes 650,240 and for a 165-byte
// token account 1,488,440 lamports.
const RESERVE = 650_240n;
const TOKEN_ACCOUNT_RENT = 1_488_440n;
const swapTx = { signatures: 1, computeUnitLimit: 113_771, computeUnitPriceMicroLamports: 831n };
const payTx = { signatures: 1, computeUnitLimit: 16_798, computeUnitPriceMicroLamports: 831n };

test('transaction fee is 5000 per signature plus ceil(price x limit / 1e6)', () => {
  assert.equal(transactionFee(swapTx), 5000n + 95n); // 831 x 113771 = 94,543,701 -> ceil 95
  assert.equal(transactionFee({ signatures: 2, computeUnitLimit: 1_000_000, computeUnitPriceMicroLamports: 1n }), 10_000n + 1n);
  assert.equal(SIGNATURE_FEE_LAMPORTS, 5000n);
});

test('single transaction, enough SOL', () => {
  const b = lamportsRequired({ transactions: [swapTx], swapOutflowLamports: 2_039_280n, payeeAccountMissing: false, payeeAccountRentLamports: TOKEN_ACCOUNT_RENT, reserveLamports: RESERVE });
  assert.equal(b.total, 5095n + 2_039_280n + RESERVE);
  assert.equal(b.payeeAccountRent, 0n);
  assert.ok(3_000_000n >= b.total);
});

test('single transaction, short', () => {
  const b = lamportsRequired({ transactions: [swapTx], swapOutflowLamports: 2_039_280n, payeeAccountMissing: false, payeeAccountRentLamports: TOKEN_ACCOUNT_RENT, reserveLamports: RESERVE });
  const have = 2_000_000n;
  assert.ok(have < b.total);
  assert.equal(solShortageReason(b.total, have), 'not enough SOL for network fees and account rent: need at least 0.002694615 SOL, have 0.002 SOL');
});

test('two transactions with the payee account missing, enough', () => {
  const b = lamportsRequired({ transactions: [swapTx, payTx], swapOutflowLamports: 0n, payeeAccountMissing: true, payeeAccountRentLamports: TOKEN_ACCOUNT_RENT, reserveLamports: RESERVE });
  assert.equal(b.fees, 5095n + 5014n); // 831 x 16798 = 13,959,138 -> ceil 14
  assert.equal(b.payeeAccountRent, TOKEN_ACCOUNT_RENT);
  assert.equal(b.total, 10_109n + TOKEN_ACCOUNT_RENT + RESERVE);
  assert.ok(2_200_000n >= b.total);
});

test('two transactions with the payee account missing, short', () => {
  const b = lamportsRequired({ transactions: [swapTx, payTx], swapOutflowLamports: 0n, payeeAccountMissing: true, payeeAccountRentLamports: TOKEN_ACCOUNT_RENT, reserveLamports: RESERVE });
  assert.ok(2_100_000n < b.total);
  assert.equal(solShortageReason(b.total, 2_100_000n), 'not enough SOL for network fees and account rent: need at least 0.002148789 SOL, have 0.0021 SOL');
});

test('two transactions with the payee account present adds no rent', () => {
  const b = lamportsRequired({ transactions: [swapTx, payTx], swapOutflowLamports: 0n, payeeAccountMissing: false, payeeAccountRentLamports: TOKEN_ACCOUNT_RENT, reserveLamports: RESERVE });
  assert.equal(b.payeeAccountRent, 0n);
});

test('payer outflow excludes the fee the simulation already deducted', () => {
  assert.equal(payerOutflow(108_999_480n, 108_993_480n, 6000n), 0n);
  assert.equal(payerOutflow(108_999_480n, 106_954_200n, 6000n), 2_039_280n);
});

test('log-detected shortage: the System program line maps to the SOL reason', () => {
  const logs = ['Program 11111111111111111111111111111111 invoke [2]', 'Transfer: insufficient lamports 880540, need 1488440', 'Program 11111111111111111111111111111111 failed: custom program error: 0x1'];
  const shortfall = lamportShortfall(logs);
  assert.equal(shortfall, 607_900n);
  const balance = 880_540n;
  assert.equal(solShortageReason(balance + shortfall + RESERVE, balance), 'not enough SOL for network fees and account rent: need at least 0.00213868 SOL, have 0.00088054 SOL');
});

test('pre-check shortage: one signature fee plus the reserve', () => {
  assert.equal(solShortageReason(5000n + RESERVE, 0n), 'not enough SOL for network fees and account rent: need at least 0.00065524 SOL, have 0 SOL');
});

test('a custom error code without the log line is not a SOL shortage', () => {
  assert.equal(lamportShortfall(['Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771']), null);
  assert.equal(lamportShortfall(null), null);
  assert.equal(lamportShortfall([]), null);
});

test('formatSol prints up to 9 decimals without trailing zeros', () => {
  assert.equal(formatSol(0n), '0');
  assert.equal(formatSol(1n), '0.000000001');
  assert.equal(formatSol(1_000_000_000n), '1');
  assert.equal(formatSol(108_999_480n), '0.10899948');
});
