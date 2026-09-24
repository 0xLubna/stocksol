// The pay page's own check of every transaction it is asked to sign, run before the wallet is
// asked and again on what the wallet returns. Pure: takes deserialized transactions and lookup
// tables the page resolved from chain through /api/rpc, never anything /api/pay said about itself.

import { PublicKey } from '@solana/web3.js';
import type { AddressLookupTableAccount, MessageAccountKeys, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { USDC } from '../registry';

/** Jupiter's swap program: the swap instruction's programId in the step 4 and step 5 reads. */
export const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TRANSFER_CHECKED_OPCODE = 12;

const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
const ALLOWED_PROGRAMS = new Set([COMPUTE_BUDGET_PROGRAM_ID, ATA_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM_ID.toBase58(), JUPITER_PROGRAM_ID]);
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM_ID.toBase58()]);

export type CheckInput = {
  transactions: VersionedTransaction[];
  lookupTables: AddressLookupTableAccount[];
  payer: PublicKey;
  recipient: PublicKey;
  /** Raw USDC units (6 decimals). */
  amountUsdc: bigint;
  reference: PublicKey;
};

export type CheckResult = { ok: true } | { ok: false; reason: string };

function fail(reason: string): CheckResult {
  return { ok: false, reason };
}

// Associated Token Account program: create has empty data, create-idempotent the single byte 1.
function isAtaCreate(data: Uint8Array): boolean {
  return data.length === 0 || (data.length === 1 && data[0] === 1);
}

export function checkPayment(input: CheckInput): CheckResult {
  if (input.transactions.length === 0) return fail('no transactions');
  const usdcMint = new PublicKey(USDC.mint);
  const payer = input.payer.toBase58();
  const recipient = input.recipient.toBase58();
  const payerAta = getAssociatedTokenAddressSync(usdcMint, input.payer, false, TOKEN_PROGRAM_ID).toBase58();
  const recipientAta = getAssociatedTokenAddressSync(usdcMint, input.recipient, false, TOKEN_PROGRAM_ID).toBase58();

  const resolved: MessageAccountKeys[] = [];
  for (const tx of input.transactions) {
    const statics = tx.message.staticAccountKeys;
    if (statics.length === 0 || statics[0].toBase58() !== payer) return fail('fee payer is not the payer');
    try {
      resolved.push(tx.message.getAccountKeys({ addressLookupTableAccounts: input.lookupTables }));
    } catch {
      return fail('lookup tables not resolved');
    }
  }

  // The payment transaction is the last one; its last instruction is the transfer.
  const last = input.transactions.length - 1;
  const paymentTx = input.transactions[last];
  const paymentKeys = resolved[last];
  const paymentIxs = paymentTx.message.compiledInstructions;
  if (paymentIxs.length === 0) return fail('payment transaction has no instructions');
  const transfer = paymentIxs[paymentIxs.length - 1];
  if (paymentKeys.get(transfer.programIdIndex)?.toBase58() !== TOKEN_PROGRAM) {
    return fail('last instruction is not a Token program instruction');
  }
  const data = transfer.data;
  if (data.length !== 10 || data[0] !== TRANSFER_CHECKED_OPCODE) return fail('last instruction is not transferChecked');
  const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
  if (amount !== input.amountUsdc) return fail('last instruction amount is not the payment amount');
  if (data[9] !== USDC.decimals) return fail('last instruction decimals are not 6');
  const actualKeys = transfer.accountKeyIndexes.map((i) => paymentKeys.get(i)?.toBase58() ?? '');
  const expectedKeys = [payerAta, usdcMint.toBase58(), recipientAta, payer, input.reference.toBase58()];
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((k, i) => k !== expectedKeys[i])) {
    return fail('last instruction keys are not payer ATA, USDC mint, recipient ATA, payer, reference');
  }
  const referenceIndex = transfer.accountKeyIndexes[4];
  if (paymentTx.message.isAccountSigner(referenceIndex)) return fail('reference is a signer');
  if (paymentTx.message.isAccountWritable(referenceIndex)) return fail('reference is writable');

  // Every other top-level instruction: an allowed program; Associated Token only as a create; no
  // Token or Token-2022 instruction but the transfer; on the split path the payment transaction
  // holds only Compute Budget, at most one create of the recipient's USDC account, and the transfer.
  const expectedCreateKeys = [payer, recipientAta, recipient, usdcMint.toBase58(), SYSTEM_PROGRAM_ID, TOKEN_PROGRAM];
  for (let t = 0; t <= last; t += 1) {
    const keys = resolved[t];
    const ixs = input.transactions[t].message.compiledInstructions;
    const isSplitPayment = last > 0 && t === last;
    let creates = 0;
    for (let i = 0; i < ixs.length; i += 1) {
      const where = `transaction ${t} instruction ${i}`;
      const program = keys.get(ixs[i].programIdIndex)?.toBase58() ?? '';
      if (!ALLOWED_PROGRAMS.has(program)) return fail(`${where}: program not allowed`);
      if (t === last && i === ixs.length - 1) continue;
      if (TOKEN_PROGRAMS.has(program)) return fail(`${where}: token instruction other than the payment transfer`);
      if (program === ATA_PROGRAM) {
        if (!isAtaCreate(ixs[i].data)) return fail(`${where}: associated token instruction is not a create`);
        if (isSplitPayment) {
          creates += 1;
          if (creates > 1) return fail(`${where}: more than one account create in the payment transaction`);
          const createKeys = ixs[i].accountKeyIndexes.map((k) => keys.get(k)?.toBase58() ?? '');
          if (createKeys.length !== expectedCreateKeys.length || createKeys.some((k, j) => k !== expectedCreateKeys[j])) {
            return fail(`${where}: account create is not the recipient USDC account`);
          }
        }
        continue;
      }
      if (isSplitPayment && program !== COMPUTE_BUDGET_PROGRAM_ID) return fail(`${where}: not allowed in the payment transaction`);
    }
  }
  return { ok: true };
}
