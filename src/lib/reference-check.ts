// Has this Solana Pay reference been paid already? Pure: the page reads the reference's signatures
// through /api/rpc and asks /api/verify about each successful one, then hands both here.

export const REFERENCE_LOOKUP_LIMIT = 10;
export const REFERENCE_USED = "This link's reference has been used before.";
export const ALREADY_PAID = 'This request is already paid.';

export type ReferenceEntry = { signature: string; err: unknown };
export type VerifyOutcome = { kind: 'response'; status: number; ok: boolean } | { kind: 'threw' };
export type ReferenceCheck =
  | { status: 'clear' }
  | { status: 'refused'; reason: string; signature: string | null }
  | { status: 'incomplete' };

/** The entries whose transaction succeeded; only these are asked of the verifier. */
export function successfulSignatures(entries: ReferenceEntry[]): string[] {
  return entries.filter((e) => e.err === null || e.err === undefined).map((e) => e.signature);
}

export function evaluateReference(entries: ReferenceEntry[] | null, outcomes: ReadonlyMap<string, VerifyOutcome>): ReferenceCheck {
  if (entries === null) return { status: 'incomplete' };
  if (entries.length >= REFERENCE_LOOKUP_LIMIT) return { status: 'refused', reason: REFERENCE_USED, signature: null };
  let incomplete = false;
  for (const signature of successfulSignatures(entries)) {
    const outcome = outcomes.get(signature);
    if (!outcome || outcome.kind === 'threw' || outcome.status !== 200) {
      incomplete = true;
      continue;
    }
    if (outcome.ok) return { status: 'refused', reason: ALREADY_PAID, signature };
  }
  return incomplete ? { status: 'incomplete' } : { status: 'clear' };
}
