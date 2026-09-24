// Tests for the reference path and the keyed store of src/lib/merchant-watch.ts. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { selectToVerify, applyOutcome, initialWatch, MERCHANT_VERIFY_PER_POLL, newWatch, watchFor, storeWatch, isCurrent, skipSet } = loadTs('src/lib/merchant-watch.ts');

const ok = (sig) => ({ signature: sig, err: null });
const failed = (sig) => ({ signature: sig, err: { InstructionError: [0, 'Custom'] } });

test('skips entries with an err', () => {
  assert.deepEqual(selectToVerify([failed('a'), ok('b'), failed('c')], new Set()), ['b']);
});

test('skips signatures rejected before', () => {
  assert.deepEqual(selectToVerify([ok('a'), ok('b'), ok('c')], new Set(['b'])), ['a', 'c']);
});

test('keeps the lookup order (newest first) and stops at the per-poll limit', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ok(`s${i}`));
  const picked = selectToVerify(entries, new Set());
  assert.equal(picked.length, MERCHANT_VERIFY_PER_POLL);
  assert.deepEqual(picked, ['s0', 's1', 's2', 's3', 's4']);
});

test('200 ok true pays by reference and marks the signature checked', () => {
  const next = applyOutcome(initialWatch, 'a', { kind: 'response', status: 200, ok: true });
  assert.equal(next.paid, 'a');
  assert.equal(next.foundBy, 'reference');
  assert.ok(next.checked.has('a'));
});

test('200 ok false is remembered, skipped from then on, and flags a mismatch', () => {
  const next = applyOutcome(initialWatch, 'a', { kind: 'response', status: 200, ok: false });
  assert.equal(next.paid, null);
  assert.equal(next.mismatch, true);
  assert.ok(next.rejected.has('a'));
  assert.ok(next.checked.has('a'));
  assert.deepEqual(selectToVerify([ok('a'), ok('b')], skipSet(next)), ['b']);
  assert.equal(initialWatch.rejected.size, 0);
  assert.equal(initialWatch.checked.size, 0);
});

test('a throw or a non-200 answer changes nothing, so it is retried next poll', () => {
  assert.equal(applyOutcome(initialWatch, 'a', { kind: 'threw' }), initialWatch);
  assert.equal(applyOutcome(initialWatch, 'a', { kind: 'response', status: 404, ok: false }), initialWatch);
  assert.deepEqual(selectToVerify([ok('a')], skipSet(initialWatch)), ['a']);
});

const paidState = (sig) => applyOutcome(initialWatch, sig, { kind: 'response', status: 200, ok: true });

test("a stale round's write is ignored: the stored watch belongs to another reference", () => {
  const stored = newWatch('refB');
  const after = storeWatch(stored, 'refA', paidState('oldSig'));
  assert.equal(after, stored);
  assert.equal(after.state.paid, null);
  assert.equal(watchFor(after, 'refB').paid, null);
});

test("a matching round's write is kept", () => {
  const stored = newWatch('refA');
  const after = storeWatch(stored, 'refA', paidState('sig'));
  assert.equal(after.reference, 'refA');
  assert.equal(after.state.paid, 'sig');
  assert.equal(watchFor(after, 'refA').paid, 'sig');
});

test('a new request starts from nothing, with its own boundary', () => {
  const old = storeWatch(newWatch('refA'), 'refA', applyOutcome(initialWatch, 'x', { kind: 'response', status: 200, ok: false }));
  assert.ok(old.state.rejected.has('x'));
  assert.equal(watchFor(old, 'refB'), initialWatch);
  const fresh = newWatch('refB', 'boundarySig');
  assert.equal(fresh.state.paid, null);
  assert.equal(fresh.state.rejected.size, 0);
  assert.equal(fresh.state.checked.size, 0);
  assert.deepEqual(fresh.state.amount.queue, []);
  assert.equal(fresh.state.amount.boundary, 'boundarySig');
  assert.equal(storeWatch(null, 'refB', paidState('sig')), null);
  assert.equal(watchFor(null, 'refB'), initialWatch);
});

test('isCurrent: true for the stored reference, false for another, false with nothing stored, false once a second is stored', () => {
  const first = newWatch('refA');
  assert.equal(isCurrent(first, 'refA'), true);
  assert.equal(isCurrent(first, 'refB'), false);
  assert.equal(isCurrent(null, 'refA'), false);
  const second = newWatch('refB');
  assert.equal(isCurrent(second, 'refA'), false);
  assert.equal(isCurrent(second, 'refB'), true);
});
