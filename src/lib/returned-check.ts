// The post-sign check: what the wallet returned must be the payment that was checked, with only
// trailing Lighthouse assertions and Compute Budget changes allowed. Pure; the page resolves any
// lookup table the returned message names and hands both transaction lists here.

import { TransactionMessage } from '@solana/web3.js';
import type { AddressLookupTableAccount, MessageAccountKeys, PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { checkPayment, trailingLighthouseCount } from './check-payment';
import { transactionCost, transactionFee } from './sol-budget';

const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();

export type ReturnedCheckInput = {
  checked: VersionedTransaction[];
  returned: VersionedTransaction[];
  lookupTables: AddressLookupTableAccount[];
  payer: PublicKey;
  recipient: PublicKey;
  amountUsdc: bigint;
  reference: PublicKey;
};

export type ReturnedCheckResult = {
  ok: boolean;
  reason?: string;
  /** One line per instruction and per transaction; program ids only, no other address. */
  log: string[];
  fees: { checked: bigint; returned: bigint }[];
};

/** C raised by a higher returned fee, never lowered by a lower one. */
export function adjustedMaxLoss(c: bigint, checkedFee: bigint, returnedFee: bigint): bigint {
  return returnedFee > checkedFee ? c + (returnedFee - checkedFee) : c;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameInstruction(a: TransactionInstruction, b: TransactionInstruction): boolean {
  if (!a.programId.equals(b.programId) || a.keys.length !== b.keys.length || !sameBytes(a.data, b.data)) return false;
  return a.keys.every((k, i) => k.pubkey.equals(b.keys[i].pubkey) && k.isSigner === b.keys[i].isSigner && k.isWritable === b.keys[i].isWritable);
}

const isComputeBudget = (ix: TransactionInstruction) => ix.programId.toBase58() === COMPUTE_BUDGET_PROGRAM_ID;

export function checkReturned(input: ReturnedCheckInput): ReturnedCheckResult {
  const log: string[] = [];
  const fees: { checked: bigint; returned: bigint }[] = [];
  const fail = (reason: string): ReturnedCheckResult => ({ ok: false, reason, log, fees });
  if (input.returned.length !== input.checked.length) return fail('returned transaction count differs');

  // Log every returned transaction first, pass or fail.
  const resolved: MessageAccountKeys[] = [];
  for (let t = 0; t < input.returned.length; t += 1) {
    const returned = input.returned[t];
    const checked = input.checked[t];
    let keys: MessageAccountKeys;
    try {
      keys = returned.message.getAccountKeys({ addressLookupTableAccounts: input.lookupTables });
    } catch {
      return fail('lookup tables not resolved');
    }
    resolved.push(keys);
    const ixs = returned.message.compiledInstructions;
    const isPayment = t === input.returned.length - 1;
    // The transfer's position for the marks: the last Token program instruction below any
    // trailing Lighthouse, in the payment transaction only.
    let transferAt = -1;
    if (isPayment) {
      for (let i = ixs.length - 1 - trailingLighthouseCount(keys, ixs); i >= 0; i -= 1) {
        if (keys.get(ixs[i].programIdIndex)?.toBase58() === TOKEN_PROGRAM) {
          transferAt = i;
          break;
        }
      }
    }
    ixs.forEach((ix, i) => {
      const mark = transferAt < 0 || i < transferAt ? 'before the transfer' : i === transferAt ? 'the transfer' : 'after the transfer';
      log.push(`tx ${t} #${i} ${keys.get(ix.programIdIndex)?.toBase58() ?? 'unknown'} ${mark}`);
    });
    const budgetOf = (tx: VersionedTransaction) =>
      tx.message.compiledInstructions
        .filter((ix) => tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58() === COMPUTE_BUDGET_PROGRAM_ID)
        .map((ix) => Array.from(ix.data).join(','));
    const budgetChanged = budgetOf(checked).join(';') !== budgetOf(returned).join(';');
    log.push(`tx ${t} compute budget ${budgetChanged ? 'changed' : 'unchanged'}`);
    const fee = { checked: transactionFee(transactionCost(checked)), returned: transactionFee(transactionCost(returned)) };
    fees.push(fee);
    log.push(`tx ${t} fee checked ${fee.checked} returned ${fee.returned} lamports`);
  }

  // Every rule of the pre-sign check, with trailing Lighthouse set aside.
  const payment = checkPayment(
    { transactions: input.returned, lookupTables: input.lookupTables, payer: input.payer, recipient: input.recipient, amountUsdc: input.amountUsdc, reference: input.reference },
    { allowTrailingLighthouse: true },
  );
  if (!payment.ok) return fail(payment.reason);

  // Same payment: apart from trailing Lighthouse and Compute Budget instructions, the returned
  // instructions equal the checked ones in order, program, keys with flags, and data.
  for (let t = 0; t < input.returned.length; t += 1) {
    const returned = input.returned[t];
    const checked = input.checked[t];
    if (returned.message.header.numRequiredSignatures !== checked.message.header.numRequiredSignatures) return fail('signer count changed');
    let a: TransactionMessage;
    let b: TransactionMessage;
    try {
      a = TransactionMessage.decompile(checked.message, { addressLookupTableAccounts: input.lookupTables });
      b = TransactionMessage.decompile(returned.message, { addressLookupTableAccounts: input.lookupTables });
    } catch {
      return fail('lookup tables not resolved');
    }
    if (!a.payerKey.equals(b.payerKey)) return fail('fee payer changed');
    const trailing = trailingLighthouseCount(resolved[t], returned.message.compiledInstructions);
    const left = a.instructions.filter((ix) => !isComputeBudget(ix));
    const right = b.instructions.slice(0, b.instructions.length - trailing).filter((ix) => !isComputeBudget(ix));
    if (left.length !== right.length || left.some((ix, i) => !sameInstruction(ix, right[i]))) {
      return fail('returned transaction differs from the checked one');
    }
  }
  return { ok: true, log, fees };
}
