// What the swap-carrying transaction does to the payer's accounts, checked on a simulation before
// the wallet is asked. Pure: the page reads the accounts and runs the simulation through /api/rpc
// and hands the raw bytes here. Token account layout (spl-token AccountLayout): mint 0..32,
// owner 32..64, amount 64..72 u64 little-endian, the rest through 165 must not change.

import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const TOKEN_ACCOUNT_SIZE = 165;
const MINT_OFFSET = 0;
const OWNER_OFFSET = 32;
const AMOUNT_OFFSET = 64;
const AMOUNT_END = 72;
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

export type CheckedAccount = {
  address: string;
  /** Raw data before the simulation; null when the account does not exist yet. */
  pre: Uint8Array | null;
  /** Raw data after the simulation; null when the simulation returned no account. */
  post: Uint8Array | null;
};

export type SimulationCheckInput = {
  err: unknown;
  payerPreLamports: bigint;
  payerPostLamports: bigint | null;
  accounts: CheckedAccount[];
  payer: string;
  holdingMint: string;
  usdcMint: string;
  payerUsdcAccount: string;
  inAmount: bigint;
  otherAmountThreshold: bigint;
  amountUsdc: bigint;
  single: boolean;
  /** C: lamportsRequired minus the reserve. */
  maxLamportsLoss: bigint;
  /** Split path: the payment transaction's fee, added to the simulated loss. Zero on the single path. */
  paymentFee: bigint;
};

export type SimulationCheckResult = { ok: true } | { ok: false; reason: string };

export function tokenAmount(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(AMOUNT_OFFSET, true);
}
export function tokenMint(data: Uint8Array): string {
  return new PublicKey(data.subarray(MINT_OFFSET, MINT_OFFSET + 32)).toBase58();
}
export function tokenOwner(data: Uint8Array): string {
  return new PublicKey(data.subarray(OWNER_OFFSET, OWNER_OFFSET + 32)).toBase58();
}

/** A token account of the payer: owned by Token or Token-2022, at least 165 bytes, owner field = payer. */
export function isPayerTokenAccount(programOwner: string, data: Uint8Array, payer: string): boolean {
  return TOKEN_PROGRAMS.has(programOwner) && data.length >= TOKEN_ACCOUNT_SIZE && tokenOwner(data) === payer;
}

export function base64ToBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function unchangedOutsideAmount(pre: Uint8Array, post: Uint8Array): boolean {
  if (post.length < TOKEN_ACCOUNT_SIZE) return false;
  for (let i = 0; i < TOKEN_ACCOUNT_SIZE; i += 1) {
    if (i >= AMOUNT_OFFSET && i < AMOUNT_END) continue;
    if (pre[i] !== post[i]) return false;
  }
  return true;
}

function fail(reason: string): SimulationCheckResult {
  return { ok: false, reason };
}

export function checkSimulation(input: SimulationCheckInput): SimulationCheckResult {
  if (input.err !== null && input.err !== undefined) return fail('the simulation reported an error');

  let holdingLoss = BigInt(0);
  let usdcGain: bigint | null = null;
  for (const account of input.accounts) {
    if (account.post === null) return fail('a token account would be closed');
    if (account.pre !== null) {
      if (!unchangedOutsideAmount(account.pre, account.post)) return fail('a token account would change beyond its balance');
    } else if (account.post.length < TOKEN_ACCOUNT_SIZE || tokenMint(account.post) !== input.usdcMint || tokenOwner(account.post) !== input.payer) {
      return fail('a token account would change beyond its balance');
    }
    const pre = account.pre === null ? BigInt(0) : tokenAmount(account.pre);
    const post = tokenAmount(account.post);
    const mint = account.pre === null ? tokenMint(account.post) : tokenMint(account.pre);
    if (account.address === input.payerUsdcAccount) {
      usdcGain = post - pre;
    } else if (mint === input.holdingMint) {
      holdingLoss += pre - post;
    } else if (post < pre) {
      return fail('another token account would lose tokens');
    }
  }
  if (holdingLoss > input.inAmount) return fail('the sale would take more of the holding than quoted');
  const requiredGain = input.single ? input.otherAmountThreshold - input.amountUsdc : input.otherAmountThreshold;
  if (usdcGain === null || usdcGain < requiredGain) return fail('the sale would leave less USDC than the guaranteed minimum');

  if (input.payerPostLamports === null) return fail('the simulation returned no payer account');
  const loss = input.payerPreLamports - input.payerPostLamports + (input.single ? BigInt(0) : input.paymentFee);
  if (loss > input.maxLamportsLoss) return fail('the payer would lose more SOL than the quoted cost');
  return { ok: true };
}
