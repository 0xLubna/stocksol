// Fixture tests for src/lib/check-payment.ts on web3.js-built v0 transactions with synthetic keys
// (generated here, secrets discarded). Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const { checkPayment, JUPITER_PROGRAM_ID } = loadTs('src/lib/check-payment.ts');
const { USDC } = loadTs('src/registry.ts');

const payer = web3.Keypair.generate().publicKey;
const recipient = web3.Keypair.generate().publicKey;
const reference = web3.Keypair.generate().publicKey;
const other = web3.Keypair.generate().publicKey;
const usdcMint = new web3.PublicKey(USDC.mint);
const payerAta = spl.getAssociatedTokenAddressSync(usdcMint, payer, false, spl.TOKEN_PROGRAM_ID);
const recipientAta = spl.getAssociatedTokenAddressSync(usdcMint, recipient, false, spl.TOKEN_PROGRAM_ID);
const otherAta = spl.getAssociatedTokenAddressSync(usdcMint, other, false, spl.TOKEN_PROGRAM_ID);
const AMOUNT = 1_000_000n;
const BLOCKHASH = 'FfAFurWDFYafyiJLq6jex1ikMaGAuhFh62d8ECBu8go6';
const expected = { payer, recipient, amountUsdc: AMOUNT, reference };

const swapIx = () =>
  new web3.TransactionInstruction({
    programId: new web3.PublicKey(JUPITER_PROGRAM_ID),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: other, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a, 1, 2, 3]),
  });

function transferIx({ amount = AMOUNT, decimals = USDC.decimals, destination = recipientAta, withReference = true, referenceWritable = false } = {}) {
  const ix = spl.createTransferCheckedInstruction(payerAta, usdcMint, destination, payer, amount, decimals, [], spl.TOKEN_PROGRAM_ID);
  if (withReference) ix.keys.push({ pubkey: reference, isSigner: false, isWritable: referenceWritable });
  return ix;
}

const budget = () => [
  web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
];
const payerAtaCreate = () => spl.createAssociatedTokenAccountIdempotentInstruction(payer, payerAta, payer, usdcMint, spl.TOKEN_PROGRAM_ID);
const payeeAtaCreate = () => spl.createAssociatedTokenAccountIdempotentInstruction(payer, recipientAta, recipient, usdcMint, spl.TOKEN_PROGRAM_ID);

function compile(instructions, payerKey = payer) {
  const message = new web3.TransactionMessage({ payerKey, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message([]);
  return new web3.VersionedTransaction(message);
}

const single = (transfer = transferIx()) => compile([...budget(), payerAtaCreate(), swapIx(), payeeAtaCreate(), transfer]);
const run = (transactions) => checkPayment({ transactions, lookupTables: [], ...expected });

test('single transaction: swap then exact transfer with reference passes', () => {
  assert.deepEqual(run([single()]), { ok: true });
});

test('two transactions: swap, then ATA create plus transfer passes', () => {
  const swapTx = compile([...budget(), payerAtaCreate(), swapIx()]);
  const payTx = compile([...budget(), payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([swapTx, payTx]), { ok: true });
});

test('wrong amount', () => {
  assert.deepEqual(run([single(transferIx({ amount: 999_999n }))]), { ok: false, reason: 'last instruction amount is not the payment amount' });
});

test('wrong decimals', () => {
  assert.deepEqual(run([single(transferIx({ decimals: 5 }))]), { ok: false, reason: 'last instruction decimals are not 6' });
});

test('wrong recipient ATA', () => {
  assert.deepEqual(run([single(transferIx({ destination: otherAta }))]), {
    ok: false,
    reason: 'last instruction keys are not payer ATA, USDC mint, recipient ATA, payer, reference',
  });
});

test('missing reference', () => {
  assert.deepEqual(run([single(transferIx({ withReference: false }))]), {
    ok: false,
    reason: 'last instruction keys are not payer ATA, USDC mint, recipient ATA, payer, reference',
  });
});

test('writable reference', () => {
  assert.deepEqual(run([single(transferIx({ referenceWritable: true }))]), { ok: false, reason: 'reference is writable' });
});

test('fee payer is not the payer', () => {
  const tx = compile([...budget(), payeeAtaCreate(), transferIx()], other);
  assert.deepEqual(run([tx]), { ok: false, reason: 'fee payer is not the payer' });
});

test('an extra USDC transfer from the payer', () => {
  const extra = spl.createTransferCheckedInstruction(payerAta, usdcMint, otherAta, payer, 1n, USDC.decimals, [], spl.TOKEN_PROGRAM_ID);
  const tx = compile([...budget(), payerAtaCreate(), swapIx(), extra, payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'transaction 0 instruction 4: token instruction other than the payment transfer' });
});

test('an instruction from another program', () => {
  const memo = new web3.TransactionInstruction({
    programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    keys: [],
    data: Buffer.from('hi'),
  });
  const tx = compile([...budget(), payerAtaCreate(), swapIx(), memo, payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'transaction 0 instruction 4: program not allowed' });
});

test('transfer not last', () => {
  const tx = compile([...budget(), payeeAtaCreate(), transferIx(), swapIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'last instruction is not a Token program instruction' });
});

test('a Token-2022 approve on a payer token account', () => {
  const approve = spl.createApproveInstruction(otherAta, other, payer, 1n, [], spl.TOKEN_2022_PROGRAM_ID);
  const tx = compile([...budget(), payerAtaCreate(), swapIx(), approve, payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'transaction 0 instruction 4: token instruction other than the payment transfer' });
});

test('a Token instruction before the transfer', () => {
  const close = spl.createCloseAccountInstruction(otherAta, payer, payer, [], spl.TOKEN_PROGRAM_ID);
  const tx = compile([...budget(), payerAtaCreate(), swapIx(), payeeAtaCreate(), close, transferIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'transaction 0 instruction 5: token instruction other than the payment transfer' });
});

test('an Associated Token Account instruction with data [2]', () => {
  const odd = new web3.TransactionInstruction({
    programId: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: payerAtaCreate().keys,
    data: Buffer.from([2]),
  });
  const tx = compile([...budget(), odd, swapIx(), payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'transaction 0 instruction 2: associated token instruction is not a create' });
});

test('a split payment transaction containing a Jupiter instruction', () => {
  const swapTx = compile([...budget(), payerAtaCreate(), swapIx()]);
  const payTx = compile([...budget(), swapIx(), payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([swapTx, payTx]), { ok: false, reason: 'transaction 1 instruction 2: not allowed in the payment transaction' });
});

test('a split payment transaction whose account create names another owner', () => {
  const swapTx = compile([...budget(), payerAtaCreate(), swapIx()]);
  const otherCreate = spl.createAssociatedTokenAccountIdempotentInstruction(payer, otherAta, other, usdcMint, spl.TOKEN_PROGRAM_ID);
  const payTx = compile([...budget(), otherCreate, transferIx()]);
  assert.deepEqual(run([swapTx, payTx]), { ok: false, reason: 'transaction 1 instruction 2: account create is not the recipient USDC account' });
});

test('trailing Lighthouse instructions refuse in the pre-sign check and pass only with the post-sign option', () => {
  const lighthouse = new web3.TransactionInstruction({
    programId: new web3.PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'),
    keys: [{ pubkey: payer, isSigner: false, isWritable: false }],
    data: Buffer.from([5, 0, 1]),
  });
  const tx = compile([...budget(), payerAtaCreate(), swapIx(), payeeAtaCreate(), transferIx(), lighthouse]);
  assert.deepEqual(run([tx]), { ok: false, reason: 'last instruction is not a Token program instruction' });
  assert.deepEqual(checkPayment({ transactions: [tx], lookupTables: [], ...expected }, { allowTrailingLighthouse: true }), { ok: true });
  const before = compile([...budget(), payerAtaCreate(), lighthouse, swapIx(), payeeAtaCreate(), transferIx()]);
  assert.deepEqual(checkPayment({ transactions: [before], lookupTables: [], ...expected }, { allowTrailingLighthouse: true }), { ok: false, reason: 'transaction 0 instruction 3: program not allowed' });
});

test('a split payment transaction with two account creates', () => {
  const swapTx = compile([...budget(), payerAtaCreate(), swapIx()]);
  const payTx = compile([...budget(), payeeAtaCreate(), payeeAtaCreate(), transferIx()]);
  assert.deepEqual(run([swapTx, payTx]), { ok: false, reason: 'transaction 1 instruction 3: more than one account create in the payment transaction' });
});

