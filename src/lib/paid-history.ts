// Has this wallet already paid this link without the reference? The payer's USDC account history
// of the last 24 hours is paged newest first and every candidate is read; nothing is skipped, and
// anything that stops the check from finishing makes it incomplete, never clear. Pure; the page
// does the reads.

export const HISTORY_PAGE_LIMIT = 20;
export const HISTORY_MAX_READS = 50;
export const HISTORY_WINDOW_SECONDS = 24 * 60 * 60;
export const ALREADY_PAID_FROM_WALLET = 'This link looks already paid from this wallet.';
export const HISTORY_UNAVAILABLE = "Can't confirm this link is unpaid right now. Try again later.";

export type HistoryEntry = { signature: string; err: unknown; blockTime?: number | null };
export type HistoryRead = { kind: 'matched' } | { kind: 'unmatched' } | { kind: 'threw' } | { kind: 'missing' };
export type HistoryCheck = { status: 'clear' } | { status: 'refused'; reason: string; signature: string } | { status: 'incomplete' };

/** Only a Solana Pay link target is checked, never an address entry. */
export function needsHistoryCheck(target: { fromLink: boolean }): boolean {
  return target.fromLink;
}

/** Within the last 24 hours, or with no block time (which must be read to be sure). */
export function withinWindow(entry: HistoryEntry, nowSeconds: number): boolean {
  return entry.blockTime === null || entry.blockTime === undefined || nowSeconds - entry.blockTime <= HISTORY_WINDOW_SECONDS;
}

/** Paging ends at a short page or at the first entry older than 24 hours. */
export function pageReachesEdge(entries: HistoryEntry[], nowSeconds: number): boolean {
  return entries.length < HISTORY_PAGE_LIMIT || entries.some((e) => !withinWindow(e, nowSeconds));
}

/** Successful entries within the window, in page order. */
export function candidatesOf(entries: HistoryEntry[], nowSeconds: number): string[] {
  return entries.filter((e) => (e.err === null || e.err === undefined) && withinWindow(e, nowSeconds)).map((e) => e.signature);
}

/** The lookup for a page: until the signature remembered by the quote-time run, before the last entry seen. */
export function historyRequest(remembered: string | null, before: string | null): { until: string | null; before: string | null } {
  return { until: remembered, before };
}

export function evaluateHistory(candidates: string[], reads: ReadonlyMap<string, HistoryRead>, reachedEdge: boolean): HistoryCheck {
  for (const signature of candidates) {
    if (reads.get(signature)?.kind === 'matched') return { status: 'refused', reason: ALREADY_PAID_FROM_WALLET, signature };
  }
  if (!reachedEdge) return { status: 'incomplete' };
  for (const signature of candidates) {
    const read = reads.get(signature);
    if (!read || read.kind === 'threw' || read.kind === 'missing') return { status: 'incomplete' };
  }
  return { status: 'clear' };
}
