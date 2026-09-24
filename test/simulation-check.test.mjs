// Tests for src/lib/simulation-check.ts on hand-built 165-byte token accounts. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const web3 = createRequire(import.meta.url)('@solana/web3.js');
const spl = createRequire(import.meta.url)('@solana/spl-token');
const { checkSimulation, isPayerTokenAccount, tokenAmount, tokenMint, tokenOwner } = loadTs('src/lib/simulation-check.ts');

const payer = web3.Keypair.generate().publicKey;
const other = web3.Keypair.generate().publicKey;
const holdingMint = web3.Keypair.generate().publicKey;
const usdcMint = web3.Keypair.generate().publicKey;
const otherMint = web3.Keypair.generate().publicKey;
const holdingAccount = web3.Keypair.generate().publicKey.toBase58();
const usdcAccount = web3.Keypair.generate().publicKey.toBase58();
const otherAccount = web3.Keypair.generate().publicKey.toBase58();

// spl-token AccountLayout: mint 0, owner 32, amount 64, delegateOption 72, delegate 76, state 108,
// isNativeOption 109, isNative 113, delegatedAmount 121, closeAuthorityOption 129, closeAuthority 133.
function account({ mint, owner = payer, amount, delegate = null, closeAuthority = null, state = 1 }) {
  const b = new Uint8Array(165);
  b.set(mint.toBytes(), 0);
  b.set(owner.toBytes(), 32);
  new DataView(b.buffer).setBigUint64(64, BigInt(amount), true);
  if (delegate) {
    new DataView(b.buffer).setUint32(72, 1, true);
    b.set(delegate.toBytes(), 76);
  }
  b[108] = state;
  if (closeAuthority) {
    new DataView(b.buffer).setUint32(129, 1, true);
    b.set(closeAuthority.toBytes(), 133);
  }
  return b;
}

const IN_AMOUNT = 130241n;
const THRESHOLD = 1000666n;
const AMOUNT = 1000000n;
const C = 2983764n; // lamportsRequired 3,634,004 minus reserve 650,240
const PRE_SOL = 61446294n;

function input(overrides = {}) {
  return {
    err: null,
    payerPreLamports: PRE_SOL,
    payerPostLamports: PRE_SOL - C,
    accounts: [
      { address: holdingAccount, pre: account({ mint: holdingMint, amount: 4521495n }), post: account({ mint: holdingMint, amount: 4521495n - IN_AMOUNT }) },
      { address: usdcAccount, pre: account({ mint: usdcMint, amount: 2000000n }), post: account({ mint: usdcMint, amount: 2000000n + 5694n }) },
      { address: otherAccount, pre: account({ mint: otherMint, amount: 10n }), post: account({ mint: otherMint, amount: 10n }) },
    ],
    payer: payer.toBase58(),
    holdingMint: holdingMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    payerUsdcAccount: usdcAccount,
    inAmount: IN_AMOUNT,
    otherAmountThreshold: THRESHOLD,
    amountUsdc: AMOUNT,
    single: true,
    maxLamportsLoss: C,
    paymentFee: 0n,
    ...overrides,
  };
}
const withAccount = (index, patch) => {
  const base = input();
  base.accounts[index] = { ...base.accounts[index], ...patch };
  return base;
};

test('layout helpers read mint, owner and amount', () => {
  const a = account({ mint: holdingMint, amount: 42n });
  assert.equal(tokenMint(a), holdingMint.toBase58());
  assert.equal(tokenOwner(a), payer.toBase58());
  assert.equal(tokenAmount(a), 42n);
  assert.equal(isPayerTokenAccount(spl.TOKEN_2022_PROGRAM_ID.toBase58(), a, payer.toBase58()), true);
  assert.equal(isPayerTokenAccount(spl.TOKEN_PROGRAM_ID.toBase58(), account({ mint: holdingMint, owner: other, amount: 1n }), payer.toBase58()), false);
  assert.equal(isPayerTokenAccount(web3.SystemProgram.programId.toBase58(), a, payer.toBase58()), false);
  assert.equal(isPayerTokenAccount(spl.TOKEN_PROGRAM_ID.toBase58(), a.subarray(0, 100), payer.toBase58()), false);
});

test('pass: holding down by inAmount, USDC up by at least threshold minus amount, SOL loss at most C', () => {
  assert.deepEqual(checkSimulation(input()), { ok: true });
});

test('pass at the exact edges: holding loss equal to inAmount, gain equal to the minimum, loss equal to C', () => {
  const edge = withAccount(1, { post: account({ mint: usdcMint, amount: 2000000n + (THRESHOLD - AMOUNT) }) });
  assert.deepEqual(checkSimulation(edge), { ok: true });
});

test('the holding over-spent', () => {
  const r = checkSimulation(withAccount(0, { post: account({ mint: holdingMint, amount: 4521495n - IN_AMOUNT - 1n }) }));
  assert.deepEqual(r, { ok: false, reason: 'the sale would take more of the holding than quoted' });
});

test('USDC gain short', () => {
  const r = checkSimulation(withAccount(1, { post: account({ mint: usdcMint, amount: 2000000n + (THRESHOLD - AMOUNT) - 1n }) }));
  assert.deepEqual(r, { ok: false, reason: 'the sale would leave less USDC than the guaranteed minimum' });
});

test('another token account down', () => {
  const r = checkSimulation(withAccount(2, { post: account({ mint: otherMint, amount: 9n }) }));
  assert.deepEqual(r, { ok: false, reason: 'another token account would lose tokens' });
});

test('delegate set', () => {
  const r = checkSimulation(withAccount(0, { post: account({ mint: holdingMint, amount: 4521495n - IN_AMOUNT, delegate: other }) }));
  assert.deepEqual(r, { ok: false, reason: 'a token account would change beyond its balance' });
});

test('owner changed', () => {
  const r = checkSimulation(withAccount(1, { post: account({ mint: usdcMint, owner: other, amount: 2005694n }) }));
  assert.deepEqual(r, { ok: false, reason: 'a token account would change beyond its balance' });
});

test('close authority set', () => {
  const r = checkSimulation(withAccount(2, { post: account({ mint: otherMint, amount: 10n, closeAuthority: other }) }));
  assert.deepEqual(r, { ok: false, reason: 'a token account would change beyond its balance' });
});

test('account closed', () => {
  const r = checkSimulation(withAccount(2, { post: null }));
  assert.deepEqual(r, { ok: false, reason: 'a token account would be closed' });
});

test('SOL over C', () => {
  const r = checkSimulation(input({ payerPostLamports: PRE_SOL - C - 1n }));
  assert.deepEqual(r, { ok: false, reason: 'the payer would lose more SOL than the quoted cost' });
});

test('split path: USDC must gain the whole threshold and the payment fee counts toward C', () => {
  const split = input({ single: false, paymentFee: 5014n, payerPostLamports: PRE_SOL - (C - 5014n) });
  split.accounts[1] = { address: usdcAccount, pre: account({ mint: usdcMint, amount: 2000000n }), post: account({ mint: usdcMint, amount: 2000000n + THRESHOLD }) };
  assert.deepEqual(checkSimulation(split), { ok: true });
  const overC = { ...split, payerPostLamports: PRE_SOL - (C - 5014n) - 1n };
  assert.deepEqual(checkSimulation(overC), { ok: false, reason: 'the payer would lose more SOL than the quoted cost' });
  const short = { ...split, accounts: split.accounts.map((a, i) => (i === 1 ? { ...a, post: account({ mint: usdcMint, amount: 2000000n + THRESHOLD - 1n }) } : a)) };
  assert.deepEqual(checkSimulation(short), { ok: false, reason: 'the sale would leave less USDC than the guaranteed minimum' });
});

test('simulation error', () => {
  assert.deepEqual(checkSimulation(input({ err: { InstructionError: [3, { Custom: 6001 }] } })), { ok: false, reason: 'the simulation reported an error' });
});

test('a payer USDC account that does not exist yet counts from zero and must be created for the payer', () => {
  const fresh = withAccount(1, { pre: null, post: account({ mint: usdcMint, amount: 5694n }) });
  assert.deepEqual(checkSimulation(fresh), { ok: true });
  const wrongOwner = withAccount(1, { pre: null, post: account({ mint: usdcMint, owner: other, amount: 5694n }) });
  assert.deepEqual(checkSimulation(wrongOwner), { ok: false, reason: 'a token account would change beyond its balance' });
});
