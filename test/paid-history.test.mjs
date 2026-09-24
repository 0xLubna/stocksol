// Tests for src/lib/paid-history.ts: the payer's USDC history check for a link. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { needsHistoryCheck, withinWindow, pageReachesEdge, candidatesOf, historyRequest, evaluateHistory, ALREADY_PAID_FROM_WALLET, HISTORY_PAGE_LIMIT, HISTORY_WINDOW_SECONDS, HISTORY_MAX_READS } =
  loadTs('src/lib/paid-history.ts');

const NOW = 1_790_250_000;
const entry = (sig, ageSeconds, err = null) => ({ signature: sig, err, blockTime: ageSeconds === null ? null : NOW - ageSeconds });
const reads = (pairs) => new Map(pairs);

test('a match refuses with that signature', () => {
  const r = evaluateHistory(['a', 'b'], reads([['a', { kind: 'unmatched' }], ['b', { kind: 'matched' }]]), true);
  assert.deepEqual(r, { status: 'refused', reason: ALREADY_PAID_FROM_WALLET, signature: 'b' });
});

test('the same match where the payer is not a signer clears (the caller reads it as unmatched)', () => {
  assert.deepEqual(evaluateHistory(['b'], reads([['b', { kind: 'unmatched' }]]), true), { status: 'clear' });
});

test('one millionth off clears (unmatched by the amount rule)', () => {
  assert.deepEqual(evaluateHistory(['b'], reads([['b', { kind: 'unmatched' }]]), true), { status: 'clear' });
});

test('an err entry is skipped as a candidate', () => {
  assert.deepEqual(candidatesOf([entry('a', 10, { InstructionError: [0, 'x'] }), entry('b', 20)], NOW), ['b']);
});

test('an entry older than 24 hours is skipped and ends paging', () => {
  const page = [entry('a', 60), entry('b', HISTORY_WINDOW_SECONDS + 1)];
  assert.deepEqual(candidatesOf(page, NOW), ['a']);
  assert.equal(pageReachesEdge(page, NOW), true);
  const full = Array.from({ length: HISTORY_PAGE_LIMIT }, (_, i) => entry(`s${i}`, i));
  assert.equal(pageReachesEdge(full, NOW), false);
  assert.equal(pageReachesEdge(full.slice(0, HISTORY_PAGE_LIMIT - 1), NOW), true);
  assert.equal(withinWindow(entry('x', HISTORY_WINDOW_SECONDS), NOW), true);
});

test('a missing blockTime is read', () => {
  assert.deepEqual(candidatesOf([entry('a', null)], NOW), ['a']);
  assert.equal(withinWindow({ signature: 'a', err: null }, NOW), true);
});

test('a throw or a missing transaction cannot complete', () => {
  assert.deepEqual(evaluateHistory(['a'], reads([['a', { kind: 'threw' }]]), true), { status: 'incomplete' });
  assert.deepEqual(evaluateHistory(['a'], reads([['a', { kind: 'missing' }]]), true), { status: 'incomplete' });
  assert.deepEqual(evaluateHistory(['a'], reads([]), true), { status: 'incomplete' });
});

test('the cap reached before the 24-hour edge cannot complete, even with every read unmatched', () => {
  const candidates = Array.from({ length: HISTORY_MAX_READS }, (_, i) => `s${i}`);
  assert.deepEqual(evaluateHistory(candidates, reads(candidates.map((s) => [s, { kind: 'unmatched' }])), false), { status: 'incomplete' });
});

test('a match still refuses when the edge was not reached', () => {
  assert.deepEqual(evaluateHistory(['a'], reads([['a', { kind: 'matched' }]]), false), { status: 'refused', reason: ALREADY_PAID_FROM_WALLET, signature: 'a' });
});

test('no entries clears', () => {
  assert.deepEqual(evaluateHistory([], reads([]), true), { status: 'clear' });
  assert.deepEqual(candidatesOf([], NOW), []);
  assert.equal(pageReachesEdge([], NOW), true);
});

test('the pre-sign run reads only entries newer than the remembered signature', () => {
  assert.deepEqual(historyRequest('remembered', null), { until: 'remembered', before: null });
  assert.deepEqual(historyRequest('remembered', 'lastSeen'), { until: 'remembered', before: 'lastSeen' });
  assert.deepEqual(historyRequest(null, null), { until: null, before: null });
});

test('an address entry never runs it; a link does', () => {
  assert.equal(needsHistoryCheck({ fromLink: false }), false);
  assert.equal(needsHistoryCheck({ fromLink: true }), true);
});
