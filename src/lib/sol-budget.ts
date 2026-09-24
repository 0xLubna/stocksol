// How much SOL a payment needs before the wallet is asked to sign, and the fixed reason shown when
// the payer has less. Pure; the route feeds it balances and simulation results.

import type { VersionedTransaction } from '@solana/web3.js';

export const SIGNATURE_FEE_LAMPORTS = BigInt(5000);
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

export type TransactionCost = {
  signatures: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
};

export type BudgetInput = {
  transactions: TransactionCost[];
  /** Lamports the swap-carrying transaction moves out of the payer, excluding its fee. */
  swapOutflowLamports: bigint;
  /** Two-transaction path only: the payee's USDC account must be created by the payment. */
  payeeAccountMissing: boolean;
  payeeAccountRentLamports: bigint;
  reserveLamports: bigint;
};

export type Budget = {
  total: bigint;
  fees: bigint;
  swapOutflow: bigint;
  payeeAccountRent: bigint;
  reserve: bigint;
};

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}

export function transactionFee(cost: TransactionCost): bigint {
  const priority = ceilDiv(cost.computeUnitPriceMicroLamports * BigInt(cost.computeUnitLimit), BigInt(1_000_000));
  return SIGNATURE_FEE_LAMPORTS * BigInt(cost.signatures) + priority;
}

export function lamportsRequired(input: BudgetInput): Budget {
  const fees = input.transactions.reduce((sum, t) => sum + transactionFee(t), BigInt(0));
  const payeeAccountRent = input.payeeAccountMissing ? input.payeeAccountRentLamports : BigInt(0);
  const total = fees + input.swapOutflowLamports + payeeAccountRent + input.reserveLamports;
  return { total, fees, swapOutflow: input.swapOutflowLamports, payeeAccountRent, reserve: input.reserveLamports };
}

/** Signature count and compute budget of a compiled transaction, from its own instructions. */
export function transactionCost(tx: VersionedTransaction): TransactionCost {
  let computeUnitLimit = 200_000;
  let computeUnitPriceMicroLamports = BigInt(0);
  const keys = tx.message.staticAccountKeys;
  for (const ix of tx.message.compiledInstructions) {
    if (keys[ix.programIdIndex]?.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    if (ix.data.length === 5 && ix.data[0] === 2) computeUnitLimit = view.getUint32(1, true);
    if (ix.data.length === 9 && ix.data[0] === 3) computeUnitPriceMicroLamports = view.getBigUint64(1, true);
  }
  return { signatures: tx.message.header.numRequiredSignatures, computeUnitLimit, computeUnitPriceMicroLamports };
}

/**
 * Lamports a simulated transaction moved out of the payer, excluding its fee. Whether the
 * returned post-simulation balance already has the fee deducted was determined from a literal
 * run (SIMULATION_DEDUCTS_FEE); the fee is never counted twice.
 */
export const SIMULATION_DEDUCTS_FEE = true;
export function payerOutflow(preLamports: bigint, postLamports: bigint, fee: bigint): bigint {
  const moved = preLamports - postLamports - (SIMULATION_DEDUCTS_FEE ? fee : BigInt(0));
  return moved > BigInt(0) ? moved : BigInt(0);
}

// The System program's log line when an account cannot fund a transfer or a new account.
const INSUFFICIENT_LAMPORTS = /insufficient lamports (\d+), need (\d+)/;

/** The shortfall a failed simulation reports in its logs, or null when the logs do not say so. */
export function lamportShortfall(logs: string[] | null | undefined): bigint | null {
  for (const line of logs ?? []) {
    const m = INSUFFICIENT_LAMPORTS.exec(line);
    if (m) return BigInt(m[2]) - BigInt(m[1]);
  }
  return null;
}

export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

export function solShortageReason(needLamports: bigint, haveLamports: bigint): string {
  return `not enough SOL for network fees and account rent: need at least ${formatSol(needLamports)} SOL, have ${formatSol(haveLamports)} SOL`;
}
