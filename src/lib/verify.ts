// The app's own payment verifier: a pure function over a parsed transaction (getParsedTransaction,
// maxSupportedTransactionVersion 0). It accepts the RPC JSON shape (keys as base58 strings) and
// the web3.js shape (keys as PublicKey), so JSON fixtures and live results go through one path.

import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { USDC } from '../registry';

export type VerifyExpectation = {
  recipient: PublicKey;
  /** Raw USDC units (6 decimals). */
  amountUsdc: bigint;
  reference: PublicKey;
};

export type VerifyResult = { ok: true; recipientAta: string } | { ok: false; reason: string };

function key(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && typeof (v as { toBase58?: unknown }).toBase58 === 'function') {
    return (v as { toBase58(): string }).toBase58();
  }
  return null;
}

type AnyRecord = Record<string, unknown>;

export function verifyPayment(tx: unknown, expected: VerifyExpectation): VerifyResult {
  const t = tx as AnyRecord | null;
  const meta = t?.meta as AnyRecord | null | undefined;
  const transaction = t?.transaction as AnyRecord | undefined;
  const message = transaction?.message as AnyRecord | undefined;
  if (!meta || !message) return { ok: false, reason: 'transaction has no meta or message' };
  if (meta.err !== null && meta.err !== undefined) return { ok: false, reason: 'transaction failed' };

  const recipientAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC.mint),
    expected.recipient,
    false,
    TOKEN_PROGRAM_ID,
  ).toBase58();

  const instructions = message.instructions;
  if (!Array.isArray(instructions) || instructions.length === 0) {
    return { ok: false, reason: 'no instructions' };
  }
  const last = instructions[instructions.length - 1] as AnyRecord;
  if (key(last.programId) !== TOKEN_PROGRAM_ID.toBase58()) {
    return { ok: false, reason: 'last instruction is not a token instruction' };
  }

  const parsed = last.parsed as AnyRecord | undefined;
  if (!parsed || typeof parsed !== 'object') {
    // Partially decoded: the parser did not recognise it, so it is not a plain transfer.
    return { ok: false, reason: 'last instruction is not a parsed transfer' };
  }
  const type = parsed.type;
  if (type !== 'transfer' && type !== 'transferChecked') {
    return { ok: false, reason: 'last instruction is not a transfer' };
  }
  const info = parsed.info as AnyRecord | undefined;
  if (key(info?.destination) !== recipientAta) {
    return { ok: false, reason: 'last instruction does not pay the recipient' };
  }
  // The token parser (agave transaction-status parse_token.rs) reports accounts beyond the
  // authority as `multisigAuthority` plus `signers`, so the appended reference lands in signers.
  const signers = Array.isArray(info?.signers) ? info.signers.map(key) : [];
  if (!signers.includes(expected.reference.toBase58())) {
    return { ok: false, reason: 'reference not on the transfer' };
  }

  const accountKeys = message.accountKeys;
  if (!Array.isArray(accountKeys)) return { ok: false, reason: 'no account keys' };
  const ataIndex = accountKeys.findIndex((a) => key((a as AnyRecord)?.pubkey ?? a) === recipientAta);
  if (ataIndex < 0) return { ok: false, reason: 'recipient token account not in transaction' };

  const balance = (list: unknown): bigint => {
    if (!Array.isArray(list)) return BigInt(0);
    const entry = list.find((b) => (b as AnyRecord)?.accountIndex === ataIndex) as AnyRecord | undefined;
    const amount = (entry?.uiTokenAmount as AnyRecord | undefined)?.amount;
    return typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : BigInt(0);
  };
  const received = balance(meta.postTokenBalances) - balance(meta.preTokenBalances);
  if (received < expected.amountUsdc) {
    return { ok: false, reason: 'recipient received less than the amount' };
  }
  return { ok: true, recipientAta };
}
