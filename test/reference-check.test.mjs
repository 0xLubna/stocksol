// Tests for src/lib/reference-check.ts. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';

const { evaluateReference, successfulSignatures, REFERENCE_USED, ALREADY_PAID, REFERENCE_LOOKUP_LIMIT } = loadTs('src/lib/reference-check.ts');

const ok = (sig) => ({ signature: sig, err: null });
const failed = (sig) => ({ signature: sig, err: { InstructionError: [3, { Custom: 1 }] } });
const outcomes = (pairs) => new Map(pairs);
const passed = { kind: 'response', status: 200, ok: true };
const mismatch = { kind: 'response', status: 200, ok: false };
const notFound = { kind: 'response', status: 404, ok: false };
const threw = { kind: 'threw' };

test('a lookup that threw cannot complete', () => {
  assert.deepEqual(evaluateReference(null, outcomes([])), { status: 'incomplete' });
});

test('no entries is clear', () => {
  assert.deepEqual(evaluateReference([], outcomes([])), { status: 'clear' });
});

test('10 or more entries refuse as used before, whatever they are', () => {
  const entries = Array.from({ length: REFERENCE_LOOKUP_LIMIT }, (_, i) => failed(`sig${i}`));
  assert.deepEqual(evaluateReference(entries, outcomes([])), { status: 'refused', reason: REFERENCE_USED, signature: null });
});

test('a successful entry the verifier passes refuses as already paid with its signature', () => {
  assert.deepEqual(evaluateReference([ok('a'), ok('b')], outcomes([['a', mismatch], ['b', passed]])), { status: 'refused', reason: ALREADY_PAID, signature: 'b' });
});

test('failed entries never block and need no verify outcome', () => {
  assert.deepEqual(evaluateReference([failed('a'), failed('b')], outcomes([])), { status: 'clear' });
});

test('successful entries the verifier answers 200 ok false never block', () => {
  assert.deepEqual(evaluateReference([ok('a'), failed('b')], outcomes([['a', mismatch]])), { status: 'clear' });
});

test('a verify call that threw, answered non-200, or is missing cannot complete', () => {
  assert.deepEqual(evaluateReference([ok('a')], outcomes([['a', threw]])), { status: 'incomplete' });
  assert.deepEqual(evaluateReference([ok('a')], outcomes([['a', notFound]])), { status: 'incomplete' });
  assert.deepEqual(evaluateReference([ok('a')], outcomes([])), { status: 'incomplete' });
});

test('a pass is reported even when another entry is incomplete', () => {
  assert.deepEqual(evaluateReference([ok('a'), ok('b')], outcomes([['a', threw], ['b', passed]])), { status: 'refused', reason: ALREADY_PAID, signature: 'b' });
});

test('successfulSignatures keeps only err-null entries in order', () => {
  assert.deepEqual(successfulSignatures([ok('a'), failed('b'), ok('c')]), ['a', 'c']);
});
