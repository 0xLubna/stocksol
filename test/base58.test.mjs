// Tests for src/lib/base58.ts against web3.js's own encoding and the app's signature parser.
// Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const { PublicKey } = createRequire(import.meta.url)('@solana/web3.js');
const { encodeBase58 } = loadTs('src/lib/base58.ts');
const { parseSignature, decodeBase58 } = loadTs('src/lib/validate.ts');

// Random bytes, with the first `zeros` bytes forced to 0.
function bytes(length, zeros) {
  const b = Uint8Array.from(randomBytes(length));
  for (let i = 0; i < zeros; i += 1) b[i] = 0;
  return b;
}

test('32-byte inputs encode exactly as PublicKey.toBase58', () => {
  for (let i = 0; i < 200; i += 1) {
    const zeros = i % 8 === 0 ? (i / 8) % 5 : 0; // 0 to 4 leading zero bytes on every eighth input
    const b = bytes(32, zeros);
    assert.equal(encodeBase58(b), new PublicKey(b).toBase58());
  }
});

test('all-zero and single-zero-prefixed 32-byte inputs', () => {
  const zero = new Uint8Array(32);
  assert.equal(encodeBase58(zero), new PublicKey(zero).toBase58());
  const one = bytes(32, 1);
  assert.equal(encodeBase58(one), new PublicKey(one).toBase58());
});

test('64-byte inputs are accepted by parseSignature and decode back to the same bytes', () => {
  for (let i = 0; i < 200; i += 1) {
    const zeros = i % 10 === 0 ? (i / 10) % 4 : 0; // 0 to 3 leading zero bytes on every tenth input
    const b = bytes(64, zeros);
    const text = encodeBase58(b);
    assert.equal(parseSignature(text), text);
    assert.deepEqual(decodeBase58(text), b);
  }
});
