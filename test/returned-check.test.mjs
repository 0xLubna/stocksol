// Tests for src/lib/returned-check.ts: what the wallet returned against what was checked, on
// web3.js-built v0 transactions with synthetic keys. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const { checkReturned, adjustedMaxLoss } = loadTs('src/lib/returned-check.ts');
const { checkPayment, JUPITER_PROGRAM_ID } = loadTs('src/lib/check-payment.ts');
const { LIGHTHOUSE_PROGRAM_ID } = loadTs('src/lib/lighthouse.ts');
const { USDC } = loadTs('src/registry.ts');

const payer = web3.Keypair.generate().publicKey;
const recipient = web3.Keypair.generate().publicKey;
const reference = web3.Keypair.generate().publicKey;
const other = web3.Keypair.generate().publicKey;
const usdcMint = new web3.PublicKey(USDC.mint);
const payerAta = spl.getAssociatedTokenAddressSync(usdcMint, payer, false, spl.TOKEN_PROGRAM_ID);
const recipientAta = spl.getAssociatedTokenAddressSync(usdcMint, recipient, false, spl.TOKEN_PROGRAM_ID);
const AMOUNT = 1_000_000n;
const BLOCKHASH = 'FfAFurWDFYafyiJLq6jex1ikMaGAuhFh62d8ECBu8go6';
const expected = { payer, recipient, amountUsdc: AMOUNT, reference };

const swapIx = (data = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a, 1, 2, 3]) =>
  new web3.TransactionInstruction({
    programId: new web3.PublicKey(JUPITER_PROGRAM_ID),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: other, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
const lighthouseIx = () =>
  new web3.TransactionInstruction({ programId: new web3.PublicKey(LIGHTHOUSE_PROGRAM_ID), keys: [{ pubkey: payer, isSigner: false, isWritable: false }], data: Buffer.from([5, 0, 1]) });
const memoIx = () => new web3.TransactionInstruction({ programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from('hi') });
const transferIx = ({ referenceWritable = false } = {}) => {
  const ix = spl.createTransferCheckedInstruction(payerAta, usdcMint, recipientAta, payer, AMOUNT, USDC.decimals, [], spl.TOKEN_PROGRAM_ID);
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: referenceWritable });
  return ix;
};
const budget = (units = 200_000, price = 1000) => [web3.ComputeBudgetProgram.setComputeUnitLimit({ units }), web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })];
const payerAtaCreate = () => spl.createAssociatedTokenAccountIdempotentInstruction(payer, payerAta, payer, usdcMint, spl.TOKEN_PROGRAM_ID);
const payeeAtaCreate = () => spl.createAssociatedTokenAccountIdempotentInstruction(payer, recipientAta, recipient, usdcMint, spl.TOKEN_PROGRAM_ID);

function compile(instructions, payerKey = payer) {
  const message = new web3.TransactionMessage({ payerKey, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message([]);
  return new web3.VersionedTransaction(message);
}
const body = (opts = {}) => [payerAtaCreate(), swapIx(opts.swapData), payeeAtaCreate(), transferIx(opts)];
const checked = compile([...budget(), ...body()]);
const run = (returned, checkedTxs = [checked]) => checkReturned({ checked: checkedTxs, returned, lookupTables: [], ...expected });

test('identical returned transaction passes, with the log and fees', () => {
  const r = run([checked]);
  assert.equal(r.ok, true);
  assert.ok(r.log.some((l) => l.startsWith('tx 0 #5 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA the transfer')));
  assert.ok(r.log.includes('tx 0 compute budget unchanged'));
  assert.equal(r.fees[0].checked, r.fees[0].returned);
  assert.equal(r.fees[0].checked, 5000n + 200n); // 1000 microlamports x 200,000 units = 200 lamports
});

test('one trailing Lighthouse instruction passes', () => {
  const r = run([compile([...budget(), ...body(), lighthouseIx()])]);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.log.some((l) => l.startsWith(`tx 0 #6 ${LIGHTHOUSE_PROGRAM_ID} after the transfer`)));
});

test('three trailing Lighthouse instructions pass', () => {
  const r = run([compile([...budget(), ...body(), lighthouseIx(), lighthouseIx(), lighthouseIx()])]);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.log.filter((l) => l.includes('after the transfer')).length, 3);
});

test('a changed compute-unit limit passes and is logged as changed, with the fees', () => {
  const r = run([compile([...budget(220_000, 1000), ...body(), lighthouseIx()])]);
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.log.includes('tx 0 compute budget changed'));
  assert.equal(r.fees[0].checked, 5200n);
  assert.equal(r.fees[0].returned, 5220n);
});

test('a Lighthouse instruction before the transfer refuses', () => {
  const r = run([compile([...budget(), payerAtaCreate(), swapIx(), lighthouseIx(), payeeAtaCreate(), transferIx()])]);
  assert.deepEqual([r.ok, r.reason], [false, 'transaction 0 instruction 4: program not allowed']);
});

test('a Memo instruction after the transfer refuses', () => {
  const r = run([compile([...budget(), ...body(), memoIx()])]);
  assert.deepEqual([r.ok, r.reason], [false, 'last instruction is not a Token program instruction']);
  const afterLighthouse = run([compile([...budget(), ...body(), lighthouseIx(), memoIx()])]);
  assert.equal(afterLighthouse.ok, false);
});

test('trailing Lighthouse in the pre-sign check of /api/pay’s response refuses', () => {
  const tx = compile([...budget(), ...body(), lighthouseIx()]);
  assert.deepEqual(checkPayment({ transactions: [tx], lookupTables: [], ...expected }), { ok: false, reason: 'last instruction is not a Token program instruction' });
});

test('a changed data byte in a non-Compute-Budget instruction refuses', () => {
  const r = run([compile([...budget(), ...body({ swapData: [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a, 1, 2, 4] })])]);
  assert.deepEqual([r.ok, r.reason], [false, 'returned transaction differs from the checked one']);
});

test('the reference made writable refuses', () => {
  const r = run([compile([...budget(), ...body({ referenceWritable: true })])]);
  assert.deepEqual([r.ok, r.reason], [false, 'reference is writable']);
});

test('a changed fee payer refuses', () => {
  const r = run([compile([...budget(), ...body()], other)]);
  assert.deepEqual([r.ok, r.reason], [false, 'fee payer is not the payer']);
});

test('split path: both returned transactions are checked and logged', () => {
  const swapTx = compile([...budget(), payerAtaCreate(), swapIx()]);
  const payTx = compile([...budget(), payeeAtaCreate(), transferIx()]);
  const r = checkReturned({ checked: [swapTx, payTx], returned: [compile([...budget(), payerAtaCreate(), swapIx(), lighthouseIx()]), compile([...budget(), payeeAtaCreate(), transferIx(), lighthouseIx()])], lookupTables: [], ...expected });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.fees.length, 2);
  assert.ok(r.log.some((l) => l.startsWith('tx 1 #3 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA the transfer')));
  const wrongCount = checkReturned({ checked: [swapTx, payTx], returned: [payTx], lookupTables: [], ...expected });
  assert.deepEqual([wrongCount.ok, wrongCount.reason], [false, 'returned transaction count differs']);
});

test('adjustedMaxLoss: a higher returned fee raises C by the difference, a lower one leaves it', () => {
  assert.equal(adjustedMaxLoss(1_493_540n, 5100n, 5300n), 1_493_740n);
  assert.equal(adjustedMaxLoss(1_493_540n, 5100n, 4000n), 1_493_540n);
  assert.equal(adjustedMaxLoss(1_493_540n, 5100n, 5100n), 1_493_540n);
});
