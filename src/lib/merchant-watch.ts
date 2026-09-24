// Which signatures the merchant page asks the verifier about on each poll, and what each answer
// does to the watch. Pure; the page does the reads and the verify calls.

export const MERCHANT_LOOKUP_LIMIT = 20;
export const MERCHANT_VERIFY_PER_POLL = 5;
export const MISMATCH_TEXT = "A transaction with this reference didn't match the request. Still watching.";

export type WatchEntry = { signature: string; err: unknown };
export type WatchOutcome = { kind: 'response'; status: number; ok: boolean } | { kind: 'threw' };
export type WatchState = { paid: string | null; rejected: ReadonlySet<string>; mismatch: boolean };

export const initialWatch: WatchState = { paid: null, rejected: new Set(), mismatch: false };

/** Successful signatures not rejected before, newest first as the lookup returns them, at most `max`. */
export function selectToVerify(entries: WatchEntry[], rejected: ReadonlySet<string>, max = MERCHANT_VERIFY_PER_POLL): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.err !== null && e.err !== undefined) continue;
    if (rejected.has(e.signature)) continue;
    out.push(e.signature);
    if (out.length >= max) break;
  }
  return out;
}

/** 200 ok pays; 200 not ok is remembered and skipped from then on; anything else is retried next poll. */
export function applyOutcome(state: WatchState, signature: string, outcome: WatchOutcome): WatchState {
  if (outcome.kind !== 'response' || outcome.status !== 200) return state;
  if (outcome.ok) return { ...state, paid: signature };
  const rejected = new Set(state.rejected);
  rejected.add(signature);
  return { ...state, rejected, mismatch: true };
}

// The stored watch belongs to one reference. A round started for another request reads nothing
// from it and writes nothing back, so a late round can never show its result on a new request.
export type StoredWatch = { reference: string; state: WatchState };

export function newWatch(reference: string): StoredWatch {
  return { reference, state: initialWatch };
}

/** The state a round starts from: the stored one when the reference matches, otherwise nothing. */
export function watchFor(stored: StoredWatch | null, reference: string): WatchState {
  return stored !== null && stored.reference === reference ? stored.state : initialWatch;
}

/** Writes a round's state back only while the stored reference still matches. */
export function storeWatch(stored: StoredWatch | null, reference: string, state: WatchState): StoredWatch | null {
  return stored !== null && stored.reference === reference ? { reference, state } : stored;
}

/** True only when a watch is stored and it belongs to this reference. */
export function isCurrent(stored: StoredWatch | null, reference: string): boolean {
  return stored !== null && stored.reference === reference;
}
