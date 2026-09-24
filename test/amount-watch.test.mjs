// Tests for src/lib/amount-watch.ts and the amount path of src/lib/merchant-watch.ts. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { startAmountWatch, pageRequest, applyPage, passInProgress, nextToVerify, removeFromQueue, queueIsLong, AMOUNT_PAGE_LIMIT, AMOUNT_MAX_PAGES_PER_POLL, AMOUNT_MAX_READS_PER_POLL } =
  loadTs('src/lib/amount-watch.ts');
const { newWatch, watchFor, storeWatch, applyAmountOutcome, applyOutcome, withAmountWatch, skipSet, pollInterval, FAST_POLL_MS, SLOW_POLL_MS, SLOW_AFTER_MS } =
  loadTs('src/lib/merchant-watch.ts');

const ok = (sig) => ({ signature: sig, err: null });
const failed = (sig) => ({ signature: sig, err: { InstructionError: [0, 'Custom'] } });
// A history of n signatures, newest first: s<n-1> ... s0.
const history = (n) => Array.from({ length: n }, (_, i) => ok(`s${n - 1 - i}`));
const none = new Set();

// Serves pages the way the RPC does: newest first, `before` exclusive, `until` exclusive, limit 20.
function server(entries) {
  return ({ until, before }) => {
    let list = entries;
    if (before) list = list.slice(list.findIndex((e) => e.signature === before) + 1);
    if (until) {
      const stop = list.findIndex((e) => e.signature === until);
      if (stop >= 0) list = list.slice(0, stop);
    }
    return list.slice(0, AMOUNT_PAGE_LIMIT);
  };
}

// One poll: at most 5 pages of one pass.
function poll(w, page, skip = none) {
  let pages = 0;
  while (pages < AMOUNT_MAX_PAGES_PER_POLL) {
    w = applyPage(w, page(pageRequest(w)), skip);
    pages += 1;
    if (!passInProgress(w)) break;
  }
  return w;
}

test('the first request starts at the boundary and reads before nothing', () => {
  assert.deepEqual(pageRequest(startAmountWatch('b0')), { until: 'b0', before: null });
  assert.deepEqual(pageRequest(startAmountWatch(null)), { until: null, before: null });
});

test('45 new signatures arriving within one poll are all queued, oldest first, none skipped', () => {
  const page = server(history(45));
  const w = poll(startAmountWatch(null), page);
  assert.equal(passInProgress(w), false);
  assert.equal(w.queue.length, 45);
  assert.deepEqual(w.queue.slice(0, 3), ['s0', 's1', 's2']);
  assert.equal(w.queue[44], 's44');
  assert.equal(w.newest, 's44');
  assert.equal(queueIsLong(w), true);
});

test('a pass longer than 5 pages carries its position to the next poll and finishes there, none skipped', () => {
  const page = server(history(120));
  let w = poll(startAmountWatch(null), page);
  assert.equal(passInProgress(w), true);
  assert.equal(w.queue.length, 0);
  assert.deepEqual(pageRequest(w), { until: null, before: 's20' });
  w = poll(w, page);
  assert.equal(passInProgress(w), false);
  assert.equal(w.queue.length, 120);
  assert.deepEqual(w.queue.slice(0, 2), ['s0', 's1']);
  assert.equal(w.queue[119], 's119');
});

test('the next pass stops at the newest signature already collected and queues newer ones after', () => {
  const page = server(history(10));
  let w = poll(startAmountWatch(null), page);
  assert.equal(w.queue.length, 10);
  const later = server([ok('n1'), ok('n0'), ...history(10)]);
  assert.deepEqual(pageRequest(w), { until: 's9', before: null });
  w = poll(w, later);
  assert.deepEqual(w.queue.slice(10), ['n0', 'n1']);
  assert.equal(w.newest, 'n1');
});

test('with the boundary set to the only signature, nothing is collected', () => {
  const page = server(history(1));
  const w = poll(startAmountWatch('s0'), page);
  assert.equal(w.queue.length, 0);
});

test('entries with an err and signatures already checked are not queued', () => {
  const page = server([ok('a'), failed('b'), ok('c')]);
  const w = poll(startAmountWatch(null), page, new Set(['c']));
  assert.deepEqual(w.queue, ['a']);
});

test('the queue is verified oldest first, at most 5 per poll', () => {
  const w = poll(startAmountWatch(null), server(history(8)));
  assert.deepEqual(nextToVerify(w), ['s0', 's1', 's2', 's3', 's4']);
  assert.equal(AMOUNT_MAX_READS_PER_POLL, 5);
  assert.deepEqual(removeFromQueue(w, 's0').queue[0], 's1');
});

test("a stale round's write is ignored on the amount path", () => {
  const stored = newWatch('refB', 'boundaryB');
  const staleState = withAmountWatch(watchFor(stored, 'refA'), poll(startAmountWatch(null), server(history(3))));
  const after = storeWatch(stored, 'refA', applyAmountOutcome(staleState, 's0', 'paid'));
  assert.equal(after, stored);
  assert.equal(watchFor(after, 'refB').paid, null);
  assert.equal(watchFor(after, 'refB').amount.queue.length, 0);
  assert.equal(watchFor(after, 'refB').amount.boundary, 'boundaryB');
});

test('a signature is checked once across both paths', () => {
  let state = newWatch('ref', null).state;
  state = withAmountWatch(state, poll(state.amount, server(history(3))));
  assert.deepEqual(state.amount.queue, ['s0', 's1', 's2']);
  // The reference path finishes with s1: the amount path drops it from its queue and skips it.
  state = applyOutcome(state, 's1', { kind: 'response', status: 200, ok: false });
  assert.deepEqual(state.amount.queue, ['s0', 's2']);
  assert.ok(skipSet(state).has('s1'));
  // The amount path finishes with s0: the reference path skips it too.
  state = applyAmountOutcome(state, 's0', 'nomatch');
  assert.deepEqual(state.amount.queue, ['s2']);
  assert.ok(state.checked.has('s0'));
  const later = poll(state.amount, server(history(3)), skipSet(state));
  assert.deepEqual(later.queue, ['s2']);
  // An error leaves the signature queued for the next poll; a match pays by amount.
  assert.deepEqual(applyAmountOutcome(state, 's2', 'error').amount.queue, ['s2']);
  const paid = applyAmountOutcome(state, 's2', 'paid');
  assert.equal(paid.paid, 's2');
  assert.equal(paid.foundBy, 'amount');
});

test('the interval changes from 3 s to 30 s at 10 minutes and never stops', () => {
  assert.equal(pollInterval(0), FAST_POLL_MS);
  assert.equal(pollInterval(SLOW_AFTER_MS - 1), FAST_POLL_MS);
  assert.equal(pollInterval(SLOW_AFTER_MS), SLOW_POLL_MS);
  assert.equal(pollInterval(24 * 60 * 60 * 1000), SLOW_POLL_MS);
  assert.equal(pollInterval(30 * 24 * 60 * 60 * 1000), SLOW_POLL_MS);
});
