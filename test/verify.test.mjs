// Fixture tests for src/lib/verify.ts. Fixtures are getParsedTransaction-shaped JSON under
// test/fixtures; synthetic-base is the control the failing ones derive from, not a recorded
// payment. Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const { PublicKey } = createRequire(import.meta.url)('@solana/web3.js');
const { verifyPayment } = loadTs('src/lib/verify.ts');

const expected = {
  recipient: new PublicKey('EjHTsiLS7W8DD1WXXRz7yag7DKzkuZjGaJ12QdGRV6pd'),
  amountUsdc: 1000000n,
  reference: new PublicKey('9ddDHtiq8TrFxWGjDpoNEyqgDuVM1WN6j2G4kWmRd27Z'),
};

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('synthetic control passes', () => {
  const result = verifyPayment(fixture('synthetic-base'), expected);
  assert.equal(result.ok, true);
  assert.equal(result.recipientAta, 'FLmrXmPivZ5HjAGBkhS9jHdkkq6qw18nfy3ez4mHVkj3');
});

for (const [name, reason] of [
  ['wrong-recipient', 'last instruction does not pay the recipient'],
  ['wrong-amount', 'recipient received less than the amount'],
  ['missing-reference', 'reference not on the transfer'],
  ['instruction-after-transfer', 'last instruction is not a token instruction'],
  ['failed-transaction', 'transaction failed'],
]) {
  test(`${name} fails: ${reason}`, () => {
    const result = verifyPayment(fixture(name), expected);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  });
}

test('control fails for a different reference', () => {
  const result = verifyPayment(fixture('synthetic-base'), { ...expected, reference: PublicKey.default });
  assert.deepEqual(result, { ok: false, reason: 'reference not on the transfer' });
});

test('control fails for a larger amount', () => {
  const result = verifyPayment(fixture('synthetic-base'), { ...expected, amountUsdc: 1000001n });
  assert.deepEqual(result, { ok: false, reason: 'recipient received less than the amount' });
});

test('trailing Lighthouse instructions after the transfer are set aside and the control passes', () => {
  const result = verifyPayment(fixture('trailing-lighthouse'), expected);
  assert.equal(result.ok, true);
  assert.equal(result.recipientAta, 'FLmrXmPivZ5HjAGBkhS9jHdkkq6qw18nfy3ez4mHVkj3');
});

test('a Memo instruction after the transfer still fails, and only Lighthouse instructions count as trailing', () => {
  const withMemo = fixture('trailing-lighthouse');
  withMemo.transaction.message.instructions.push({ program: 'spl-memo', programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: 'thanks' });
  assert.deepEqual(verifyPayment(withMemo, expected), { ok: false, reason: 'last instruction is not a token instruction' });
  const onlyLighthouse = fixture('trailing-lighthouse');
  onlyLighthouse.transaction.message.instructions = onlyLighthouse.transaction.message.instructions.slice(2);
  assert.deepEqual(verifyPayment(onlyLighthouse, expected), { ok: false, reason: 'no instructions' });
});
