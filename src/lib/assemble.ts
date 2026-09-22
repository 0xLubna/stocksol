// Builds the payment transaction in the fixed order: compute-unit limit, compute-unit price, then
// the swap's setup, swap, cleanup and other instructions, an idempotent create of the payee's USDC
// ATA, and last the exact USDC transfer carrying the Solana Pay reference. Nothing after it.

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  MessageV0,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { JupiterInstruction, SwapInstructions } from './jupiter';
import { USDC } from '../registry';

export const MAX_COMPUTE_UNITS = 1_400_000;
export const MAX_TRANSACTION_BYTES = 1232;
const COMPUTE_UNIT_HEADROOM = 1.2;
/**
 * Limit for the payment-only transaction of the two-transaction path. Not simulated per request:
 * a payer holding only stock has no USDC until the swap lands, so that simulation would fail
 * exactly when the split is needed. Calibrated once on 22 Sep 2026: a simulated ATA create plus
 * transferChecked consumed 13,998 units; this is ceil(1.2x).
 */
export const PAYMENT_COMPUTE_UNIT_LIMIT = 16_798;

export type AssembleInput = {
  payer: PublicKey;
  recipient: PublicKey;
  /** Raw USDC units (6 decimals). */
  amountUsdc: bigint;
  reference: PublicKey;
  swap: SwapInstructions;
};

export type InstructionSummary = {
  transaction: number;
  index: number;
  label: string;
  programId: string;
  accounts: number;
  /** Raw amount for the compute-budget and transfer instructions; null otherwise. */
  amount: string | null;
};

export type Assembled = {
  transactions: VersionedTransaction[];
  /** True when the swap and the transfer fit one transaction. */
  single: boolean;
  /** Wire size of the single transaction compiled with the lookup tables, and without them. */
  sizes: { withTables: number; withoutTables: number };
  unitsConsumed: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
  payerUsdcAta: PublicKey;
  payeeUsdcAta: PublicKey;
  instructions: InstructionSummary[];
  simulationLogs: string[] | null;
};

export class AssembleError extends Error {
  constructor(
    message: string,
    public readonly logs: string[] | null,
  ) {
    super(message);
    this.name = 'AssembleError';
  }
}

type Labelled = { label: string; ix: TransactionInstruction; amount: string | null };

function toInstruction(j: JupiterInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(j.programId),
    keys: j.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(j.data, 'base64'),
  });
}

function lookupTables(swap: SwapInstructions): AddressLookupTableAccount[] {
  return Object.entries(swap.addressesByLookupTableAddress).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: addresses.map((a) => new PublicKey(a)),
        },
      }),
  );
}

function computeBudget(limit: number, price: bigint): Labelled[] {
  return [
    { label: 'compute-unit-limit', ix: ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), amount: String(limit) },
    { label: 'compute-unit-price', ix: ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), amount: price.toString() },
  ];
}

function swapPart(swap: SwapInstructions): Labelled[] {
  return [
    ...swap.setupInstructions.map((j) => ({ label: 'setup', ix: toInstruction(j), amount: null })),
    { label: 'swap', ix: toInstruction(swap.swapInstruction), amount: null },
    ...(swap.cleanupInstruction ? [{ label: 'cleanup', ix: toInstruction(swap.cleanupInstruction), amount: null }] : []),
    ...swap.otherInstructions.map((j) => ({ label: 'other', ix: toInstruction(j), amount: null })),
  ];
}

function usdcAtas(input: AssembleInput): { payerAta: PublicKey; payeeAta: PublicKey } {
  const usdcMint = new PublicKey(USDC.mint);
  return {
    payerAta: getAssociatedTokenAddressSync(usdcMint, input.payer, false, TOKEN_PROGRAM_ID),
    payeeAta: getAssociatedTokenAddressSync(usdcMint, input.recipient, false, TOKEN_PROGRAM_ID),
  };
}

function paymentPart(input: AssembleInput): Labelled[] {
  const usdcMint = new PublicKey(USDC.mint);
  const { payerAta, payeeAta } = usdcAtas(input);
  const create = createAssociatedTokenAccountIdempotentInstruction(
    input.payer,
    payeeAta,
    input.recipient,
    usdcMint,
    TOKEN_PROGRAM_ID,
  );
  const transfer = createTransferCheckedInstruction(
    payerAta,
    usdcMint,
    payeeAta,
    input.payer,
    input.amountUsdc,
    USDC.decimals,
    [],
    TOKEN_PROGRAM_ID,
  );
  transfer.keys.push({ pubkey: input.reference, isSigner: false, isWritable: false });
  return [
    { label: 'payee-usdc-ata-create', ix: create, amount: null },
    { label: 'usdc-transfer-checked', ix: transfer, amount: input.amountUsdc.toString() },
  ];
}

function compactU16Length(n: number): number {
  return n < 128 ? 1 : n < 16384 ? 2 : 3;
}

/**
 * Wire size of a v0 transaction carrying this message, computed from its parts. web3.js encodes
 * serialize() into a fixed 1232-byte buffer and throws above it, so the size has to be known
 * without serializing.
 */
export function byteSize(message: MessageV0): number {
  const signatures = message.header.numRequiredSignatures;
  let size = compactU16Length(signatures) + 64 * signatures;
  size += 1; // version prefix
  size += 3; // header
  size += compactU16Length(message.staticAccountKeys.length) + 32 * message.staticAccountKeys.length;
  size += 32; // blockhash
  size += compactU16Length(message.compiledInstructions.length);
  for (const ix of message.compiledInstructions) {
    size += 1;
    size += compactU16Length(ix.accountKeyIndexes.length) + ix.accountKeyIndexes.length;
    size += compactU16Length(ix.data.length) + ix.data.length;
  }
  size += compactU16Length(message.addressTableLookups.length);
  for (const lookup of message.addressTableLookups) {
    size += 32;
    size += compactU16Length(lookup.writableIndexes.length) + lookup.writableIndexes.length;
    size += compactU16Length(lookup.readonlyIndexes.length) + lookup.readonlyIndexes.length;
  }
  return size;
}

// Whenever serialize() succeeds its length must equal byteSize; a disagreement stops everything.
function checkedSize(tx: VersionedTransaction): number {
  const computed = byteSize(tx.message as MessageV0);
  let serialized: number | null = null;
  try {
    serialized = tx.serialize().length;
  } catch {
    serialized = null;
  }
  if (serialized !== null && serialized !== computed) {
    throw new AssembleError(`size check: byteSize ${computed} but serialize() gave ${serialized}`, null);
  }
  return computed;
}

function compile(
  payer: PublicKey,
  blockhash: string,
  parts: Labelled[],
  tables: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    instructions: parts.map((p) => p.ix),
    recentBlockhash: blockhash,
  }).compileToV0Message(tables);
  return new VersionedTransaction(message);
}

function summarize(transaction: number, parts: Labelled[]): InstructionSummary[] {
  return parts.map((p, index) => ({
    transaction,
    index,
    label: p.label,
    programId: p.ix.programId.toBase58(),
    accounts: p.ix.keys.length,
    amount: p.amount,
  }));
}

function limitFor(unitsConsumed: number): number {
  return Math.min(Math.ceil(unitsConsumed * COMPUTE_UNIT_HEADROOM), MAX_COMPUTE_UNITS);
}

async function simulate(connection: Connection, tx: VersionedTransaction): Promise<{ units: number; logs: string[] | null }> {
  const res = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
  const { err, logs, unitsConsumed } = res.value;
  if (err !== null) {
    throw new AssembleError(`simulation failed: ${typeof err === 'string' ? err : JSON.stringify(err)}`, logs);
  }
  if (typeof unitsConsumed !== 'number') throw new AssembleError('simulation returned no unitsConsumed', logs);
  return { units: unitsConsumed, logs };
}

/** The payment-only transaction (ATA create plus transfer) with a given limit; used to calibrate PAYMENT_COMPUTE_UNIT_LIMIT. */
export function paymentOnlyTransaction(input: AssembleInput, limit: number): VersionedTransaction {
  const price = input.swap.computeUnitPriceMicroLamports ?? BigInt(0);
  return compile(input.payer, input.swap.blockhash, computeBudget(limit, price).concat(paymentPart(input)), []);
}

/**
 * Sizes the single transaction first (byteSize, not serialize). If it fits 1232 bytes: simulate
 * once with the 1,400,000 limit, rebuild with 1.2x the units consumed. Otherwise: the swap goes in
 * one transaction, simulated alone for its limit, and the payment in a second with the constant
 * limit.
 */
export async function assemble(connection: Connection, input: AssembleInput): Promise<Assembled> {
  const { payer, swap } = input;
  const { payerAta, payeeAta } = usdcAtas(input);
  const price = swap.computeUnitPriceMicroLamports ?? BigInt(0);
  const tables = lookupTables(swap);
  const body = swapPart(swap).concat(paymentPart(input));

  // The compute-budget data is fixed-width, so the probe's size equals the sized transaction's.
  const probe = compile(payer, swap.blockhash, computeBudget(MAX_COMPUTE_UNITS, price).concat(body), tables);
  const withTables = checkedSize(probe);
  const withoutTables = checkedSize(compile(payer, swap.blockhash, computeBudget(MAX_COMPUTE_UNITS, price).concat(body), []));
  const base = { computeUnitPriceMicroLamports: price, payerUsdcAta: payerAta, payeeUsdcAta: payeeAta, sizes: { withTables, withoutTables } };

  if (withTables <= MAX_TRANSACTION_BYTES) {
    const { units, logs } = await simulate(connection, probe);
    const limit = limitFor(units);
    const parts = computeBudget(limit, price).concat(body);
    return {
      ...base,
      transactions: [compile(payer, swap.blockhash, parts, tables)],
      single: true,
      unitsConsumed: units,
      computeUnitLimit: limit,
      instructions: summarize(0, parts),
      simulationLogs: logs,
    };
  }

  const swapProbe = compile(payer, swap.blockhash, computeBudget(MAX_COMPUTE_UNITS, price).concat(swapPart(swap)), tables);
  if (checkedSize(swapProbe) > MAX_TRANSACTION_BYTES) {
    throw new AssembleError('swap alone exceeds the transaction size limit', null);
  }
  const { units, logs } = await simulate(connection, swapProbe);
  const limit = limitFor(units);
  const swapParts = computeBudget(limit, price).concat(swapPart(swap));
  const payParts = computeBudget(PAYMENT_COMPUTE_UNIT_LIMIT, price).concat(paymentPart(input));
  return {
    ...base,
    transactions: [
      compile(payer, swap.blockhash, swapParts, tables),
      compile(payer, swap.blockhash, payParts, []),
    ],
    single: false,
    unitsConsumed: units,
    computeUnitLimit: limit,
    instructions: summarize(0, swapParts).concat(summarize(1, payParts)),
    simulationLogs: logs,
  };
}
