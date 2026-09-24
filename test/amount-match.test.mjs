// Tests for src/lib/amount-match.ts on getParsedTransaction-shaped fixtures with synthetic keys.
// Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const web3 = createRequire(import.meta.url)('@solana/web3.js');
const spl = createRequire(import.meta.url)('@solana/spl-token');
const { matchAmount, isSigner } = loadTs('src/lib/amount-match.ts');
const { USDC } = loadTs('src/registry.ts');

const payer = web3.Keypair.generate().publicKey.toBase58();
const recipient = web3.Keypair.generate().publicKey.toBase58();
const reference = web3.Keypair.generate().publicKey.toBase58();
const usdc = USDC.mint;
const otherMint = web3.Keypair.generate().publicKey.toBase58();
const recipientAta = spl.getAssociatedTokenAddressSync(new web3.PublicKey(usdc), new web3.PublicKey(recipient), false, spl.TOKEN_PROGRAM_ID).toBase58();
const payerAta = spl.getAssociatedTokenAddressSync(new web3.PublicKey(usdc), new web3.PublicKey(payer), false, spl.TOKEN_PROGRAM_ID).toBase58();
const TOKEN = spl.TOKEN_PROGRAM_ID.toBase58();
const AMOUNT = 2_000_417n;

const bal = (accountIndex, owner, mint, amount) => ({ accountIndex, owner, mint, uiTokenAmount: { amount: String(amount) } });
const key = (pubkey, signer = false) => ({ pubkey, signer, writable: false, source: 'transaction' });
// The part A shape: the wallet's own transfer lists the payer again as its only extra account.
const transfer = (extras) => ({
  program: 'spl-token',
  programId: TOKEN,
  parsed: { type: 'transferChecked', info: { source: payerAta, mint: usdc, destination: recipientAta, multisigAuthority: payer, signers: extras, tokenAmount: { amount: String(AMOUNT), decimals: 6 } } },
});

function fixture({ err = null, pre = [bal(2, payer, usdc, 11108318)], post = [bal(1, recipient, usdc, AMOUNT), bal(2, payer, usdc, 11108318n - AMOUNT)], instructions = [transfer([payer])], inner = [], keys } = {}) {
  return {
    meta: { err, fee: 5000, preTokenBalances: pre, postTokenBalances: post, innerInstructions: inner },
    transaction: { message: { accountKeys: keys ?? [key(payer, true), key(recipientAta), key(payerAta), key(usdc), key(TOKEN)], instructions } },
  };
}
const input = { recipient, recipientAta, usdcMint: usdc, amountUsdc: AMOUNT };

test('exact amount passes (the part A shape: the only extra account is a signer)', () => {
  assert.deepEqual(matchAmount(fixture(), input), { ok: true });
});

test('one millionth off fails', () => {
  assert.deepEqual(matchAmount(fixture(), { ...input, amountUsdc: AMOUNT + 1n }), { ok: false, reason: 'amount received is not the unique amount' });
  assert.deepEqual(matchAmount(fixture(), { ...input, amountUsdc: AMOUNT - 1n }), { ok: false, reason: 'amount received is not the unique amount' });
});

test('a missing pre-balance counts as zero', () => {
  const withPre = fixture({ pre: [bal(1, recipient, usdc, 5), bal(2, payer, usdc, 11108318)], post: [bal(1, recipient, usdc, AMOUNT + 5n), bal(2, payer, usdc, 11108318n - AMOUNT)] });
  assert.deepEqual(matchAmount(withPre, input), { ok: true });
  assert.deepEqual(matchAmount(fixture({ post: [bal(1, recipient, usdc, AMOUNT + 5n)] }), input), { ok: false, reason: 'amount received is not the unique amount' });
});

test('wrong mint on that account fails', () => {
  const r = matchAmount(fixture({ post: [bal(1, recipient, otherMint, AMOUNT)] }), input);
  assert.deepEqual(r, { ok: false, reason: 'recipient USDC account is not a USDC account of the recipient after the transaction' });
});

test('meta.err fails', () => {
  assert.deepEqual(matchAmount(fixture({ err: { InstructionError: [0, { Custom: 1 }] } }), input), { ok: false, reason: 'transaction failed' });
});

test('a transfer into the account carrying a non-signer extra account fails', () => {
  assert.deepEqual(matchAmount(fixture({ instructions: [transfer([reference])] }), input), { ok: false, reason: 'the transfer carries a reference' });
  const innerOnly = fixture({ instructions: [{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', accounts: [], data: 'x' }], inner: [{ index: 0, instructions: [transfer([reference])] }] });
  assert.deepEqual(matchAmount(innerOnly, input), { ok: false, reason: 'the transfer carries a reference' });
});

test('a transfer whose only extra account is a signer passes, and one with no extra account passes', () => {
  assert.deepEqual(matchAmount(fixture({ instructions: [transfer([payer])] }), input), { ok: true });
  const plain = { program: 'spl-token', programId: TOKEN, parsed: { type: 'transferChecked', info: { source: payerAta, mint: usdc, destination: recipientAta, authority: payer, tokenAmount: { amount: String(AMOUNT), decimals: 6 } } } };
  assert.deepEqual(matchAmount(fixture({ instructions: [plain] }), input), { ok: true });
});

test('a token instruction into the account that the parser could not read fails', () => {
  const opaque = { programId: TOKEN, accounts: [payerAta, recipientAta], data: 'opaque' };
  assert.deepEqual(matchAmount(fixture({ instructions: [opaque] }), input), { ok: false, reason: 'a token instruction into the account could not be read' });
});

test('the recipient account must be in the account keys', () => {
  assert.deepEqual(matchAmount(fixture({ keys: [key(payer, true), key(payerAta)] }), input), { ok: false, reason: 'recipient USDC account not in transaction' });
});

test('isSigner reads the signer flag', () => {
  assert.equal(isSigner(fixture(), payer), true);
  assert.equal(isSigner(fixture(), recipient), false);
  assert.equal(isSigner(fixture({ keys: [key(payer, false)] }), payer), false);
});
