// Does a confirmed transaction pay the recipient exactly the unique amount, with no reference of
// its own? Pure over the getParsedTransaction shape (keys as base58 strings or PublicKey).

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

type AnyRecord = Record<string, unknown>;

export type AmountMatchInput = {
  recipient: string;
  recipientAta: string;
  usdcMint: string;
  amountUsdc: bigint;
};

export type AmountMatch = { ok: true } | { ok: false; reason: string };

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

export function key(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && typeof (v as { toBase58?: unknown }).toBase58 === 'function') {
    return (v as { toBase58(): string }).toBase58();
  }
  return null;
}

function fail(reason: string): AmountMatch {
  return { ok: false, reason };
}

/** True when `payer` is among the transaction's signers. */
export function isSigner(tx: unknown, payer: string): boolean {
  const keys = ((tx as AnyRecord | null)?.transaction as AnyRecord | undefined)?.message as AnyRecord | undefined;
  const accountKeys = keys?.accountKeys;
  if (!Array.isArray(accountKeys)) return false;
  return accountKeys.some((a) => key((a as AnyRecord)?.pubkey) === payer && (a as AnyRecord)?.signer === true);
}

export function matchAmount(tx: unknown, input: AmountMatchInput): AmountMatch {
  const t = tx as AnyRecord | null;
  const meta = t?.meta as AnyRecord | null | undefined;
  const message = (t?.transaction as AnyRecord | undefined)?.message as AnyRecord | undefined;
  if (!meta || !message) return fail('transaction has no meta or message');
  if (meta.err !== null && meta.err !== undefined) return fail('transaction failed');

  const accountKeys = Array.isArray(message.accountKeys) ? (message.accountKeys as AnyRecord[]) : [];
  const ataIndex = accountKeys.findIndex((a) => key(a?.pubkey ?? a) === input.recipientAta);
  if (ataIndex < 0) return fail('recipient USDC account not in transaction');
  const signers = new Set(accountKeys.filter((a) => a?.signer === true).map((a) => key(a?.pubkey) ?? ''));

  const balance = (list: unknown): AnyRecord | undefined =>
    Array.isArray(list) ? (list.find((b) => (b as AnyRecord)?.accountIndex === ataIndex) as AnyRecord | undefined) : undefined;
  const post = balance(meta.postTokenBalances);
  if (!post || post.mint !== input.usdcMint || post.owner !== input.recipient) {
    return fail('recipient USDC account is not a USDC account of the recipient after the transaction');
  }
  const raw = (b: AnyRecord | undefined): bigint => {
    const amount = (b?.uiTokenAmount as AnyRecord | undefined)?.amount;
    return typeof amount === 'string' && /^\d+$/.test(amount) ? BigInt(amount) : BigInt(0);
  };
  if (raw(post) - raw(balance(meta.preTokenBalances)) !== input.amountUsdc) return fail('amount received is not the unique amount');

  // Every Token transfer into the account, top-level or inner: any extra account that is not a
  // signer is a reference, so the payment belongs to that reference's request, not this one.
  const inner = Array.isArray(meta.innerInstructions)
    ? (meta.innerInstructions as AnyRecord[]).flatMap((g) => (Array.isArray(g.instructions) ? (g.instructions as AnyRecord[]) : []))
    : [];
  const all = [...(Array.isArray(message.instructions) ? (message.instructions as AnyRecord[]) : []), ...inner];
  for (const ix of all) {
    const program = key(ix?.programId) ?? '';
    if (!TOKEN_PROGRAMS.has(program)) continue;
    const parsed = ix.parsed as AnyRecord | undefined;
    if (!parsed || typeof parsed !== 'object') {
      const accounts = Array.isArray(ix.accounts) ? (ix.accounts as unknown[]).map(key) : [];
      if (accounts.includes(input.recipientAta)) return fail('a token instruction into the account could not be read');
      continue;
    }
    if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue;
    const info = parsed.info as AnyRecord | undefined;
    if (key(info?.destination) !== input.recipientAta) continue;
    const extras = Array.isArray(info?.signers) ? (info?.signers as unknown[]).map(key) : [];
    if (extras.some((e) => e === null || !signers.has(e))) return fail('the transfer carries a reference');
  }
  return { ok: true };
}
