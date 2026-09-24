// The merchant's amount path: every transaction on the recipient's USDC account since the request
// was created is collected, never skipped, and verified oldest first. Pure; the page reads pages
// of signatures and transactions and hands them here.

export const AMOUNT_PAGE_LIMIT = 20;
export const AMOUNT_MAX_PAGES_PER_POLL = 5;
export const AMOUNT_MAX_READS_PER_POLL = 5;
export const AMOUNT_QUEUE_WARNING = 20;
export const MANY_TRANSACTIONS_TEXT = 'Many transactions on this account; still checking.';

export type AmountEntry = { signature: string; err: unknown };

/** A collection pass in progress: pages newest first, carried over polls until it finishes. */
export type AmountPass = { before: string | null; pages: number; pending: string[]; newest: string | null };

export type AmountWatch = {
  /** The newest signature on the account when the request was created; nothing older is looked at. */
  boundary: string | null;
  /** The newest signature a finished pass has collected; the next pass stops there. */
  newest: string | null;
  pass: AmountPass | null;
  /** Oldest first. */
  queue: string[];
};

export function startAmountWatch(boundary: string | null): AmountWatch {
  return { boundary, newest: null, pass: null, queue: [] };
}

/** The lookup for the next page: until the newest already collected (the boundary at first), before the last entry seen. */
export function pageRequest(w: AmountWatch): { until: string | null; before: string | null } {
  return { until: w.newest ?? w.boundary, before: w.pass?.before ?? null };
}

/** A page of entries, newest first. Entries with an err or already handled are not queued. */
export function applyPage(w: AmountWatch, entries: AmountEntry[], skip: ReadonlySet<string>): AmountWatch {
  const pass: AmountPass = w.pass ?? { before: null, pages: 0, pending: [], newest: null };
  const known = new Set([...w.queue, ...pass.pending]);
  const fresh = entries
    .filter((e) => (e.err === null || e.err === undefined) && !skip.has(e.signature) && !known.has(e.signature))
    .map((e) => e.signature);
  const next: AmountPass = {
    before: entries.length > 0 ? entries[entries.length - 1].signature : pass.before,
    pages: pass.pages + 1,
    pending: [...pass.pending, ...fresh],
    newest: pass.newest ?? (entries.length > 0 ? entries[0].signature : null),
  };
  if (entries.length < AMOUNT_PAGE_LIMIT) {
    // The pass is complete: queue its entries oldest first after what is already queued.
    return { ...w, newest: next.newest ?? w.newest, pass: null, queue: [...w.queue, ...[...next.pending].reverse()] };
  }
  return { ...w, pass: next };
}

/** A pass that ran out of pages this poll is carried to the next one. */
export function passInProgress(w: AmountWatch): boolean {
  return w.pass !== null;
}

export function nextToVerify(w: AmountWatch, max = AMOUNT_MAX_READS_PER_POLL): string[] {
  return w.queue.slice(0, max);
}

export function removeFromQueue(w: AmountWatch, signature: string): AmountWatch {
  return { ...w, queue: w.queue.filter((s) => s !== signature) };
}

export function queueIsLong(w: AmountWatch): boolean {
  return w.queue.length > AMOUNT_QUEUE_WARNING;
}
