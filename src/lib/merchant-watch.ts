// What the merchant page asks the verifier about on each poll and what each answer does to the
// watch, on both paths: by reference (the transfer carries the request's reference) and by amount
// (a payment made without the reference, recognised by the unique amount). Pure; the page does the
// reads and the verify calls. A signature is checked once across both paths.

import { removeFromQueue, startAmountWatch, type AmountWatch } from './amount-watch';

export const MERCHANT_LOOKUP_LIMIT = 20;
export const MERCHANT_VERIFY_PER_POLL = 5;
export const MISMATCH_TEXT = "A transaction with this reference didn't match the request. Still watching.";
export const FAST_POLL_MS = 3000;
export const SLOW_POLL_MS = 30_000;
export const SLOW_AFTER_MS = 10 * 60 * 1000;
export const SLOW_TEXT = 'Waiting for payment. Still checking every 30 seconds.';

/** Every 3 s for the first 10 minutes, every 30 s after that, for as long as the page is open. */
export function pollInterval(elapsedMs: number): number {
  return elapsedMs < SLOW_AFTER_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

export type WatchEntry = { signature: string; err: unknown };
export type WatchOutcome = { kind: 'response'; status: number; ok: boolean } | { kind: 'threw' };
export type FoundBy = 'reference' | 'amount';
export type WatchState = {
  paid: string | null;
  foundBy: FoundBy | null;
  /** Reference-path signatures the verifier answered 200 ok false; they show the mismatch line. */
  rejected: ReadonlySet<string>;
  /** Every signature either path has finished with; neither path reads it again. */
  checked: ReadonlySet<string>;
  mismatch: boolean;
  amount: AmountWatch;
};

export const initialWatch: WatchState = { paid: null, foundBy: null, rejected: new Set(), checked: new Set(), mismatch: false, amount: startAmountWatch(null) };

/** Successful signatures neither path has finished with, newest first as the lookup returns them, at most `max`. */
export function selectToVerify(entries: WatchEntry[], skip: ReadonlySet<string>, max = MERCHANT_VERIFY_PER_POLL): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.err !== null && e.err !== undefined) continue;
    if (skip.has(e.signature)) continue;
    out.push(e.signature);
    if (out.length >= max) break;
  }
  return out;
}

const withChecked = (state: WatchState, signature: string): ReadonlySet<string> => new Set([...state.checked, signature]);

/** Reference path: 200 ok pays; 200 not ok is remembered and skipped from then on; anything else is retried next poll. */
export function applyOutcome(state: WatchState, signature: string, outcome: WatchOutcome): WatchState {
  if (outcome.kind !== 'response' || outcome.status !== 200) return state;
  const checked = withChecked(state, signature);
  const amount = removeFromQueue(state.amount, signature);
  if (outcome.ok) return { ...state, paid: signature, foundBy: 'reference', checked, amount };
  const rejected = new Set(state.rejected);
  rejected.add(signature);
  return { ...state, rejected, checked, mismatch: true, amount };
}

export type AmountOutcome = 'paid' | 'nomatch' | 'error';

/** Amount path: a match pays; no match is remembered and skipped silently; an error is retried next poll. */
export function applyAmountOutcome(state: WatchState, signature: string, outcome: AmountOutcome): WatchState {
  if (outcome === 'error') return state;
  const checked = withChecked(state, signature);
  const amount = removeFromQueue(state.amount, signature);
  if (outcome === 'paid') return { ...state, paid: signature, foundBy: 'amount', checked, amount };
  return { ...state, checked, amount };
}

/** What both paths skip: signatures finished with, plus reference-path mismatches. */
export function skipSet(state: WatchState): ReadonlySet<string> {
  return new Set([...state.checked, ...state.rejected]);
}

export function withAmountWatch(state: WatchState, amount: AmountWatch): WatchState {
  return { ...state, amount };
}

// The stored watch belongs to one reference. A round started for another request reads nothing
// from it and writes nothing back, so a late round can never show its result on a new request.
export type StoredWatch = { reference: string; state: WatchState };

export function newWatch(reference: string, boundary: string | null = null): StoredWatch {
  return { reference, state: { ...initialWatch, amount: startAmountWatch(boundary) } };
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
