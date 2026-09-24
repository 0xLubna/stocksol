// Tests for src/lib/pay-url.ts: every refusal, one accepted URL, and the merchant round trip.
// Run: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadTs } from './load-ts.mjs';

const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const { encodeURL, parseURL } = require('@solana/pay');
const { readPayUrl, buildRequestUrl, buildScanLink, REQUEST_LABEL } = loadTs('src/lib/pay-url.ts');
const { USDC } = loadTs('src/registry.ts');

const recipient = web3.Keypair.generate().publicKey;
const reference = web3.Keypair.generate().publicKey;
const reference2 = web3.Keypair.generate().publicKey;
const usdc = new web3.PublicKey(USDC.mint);
const otherMint = web3.Keypair.generate().publicKey;

const withAmount = (fields, amount) => {
  const url = encodeURL(fields);
  if (amount !== undefined) url.searchParams.set('amount', amount);
  return url.toString();
};

test('accepted: USDC, amount, one reference', () => {
  const r = readPayUrl(withAmount({ recipient, splToken: usdc, reference }, '1.5'));
  assert.equal(r.ok, true);
  assert.equal(r.request.recipient.toBase58(), recipient.toBase58());
  assert.equal(r.request.amountText, '1.5');
  assert.equal(r.request.reference.toBase58(), reference.toBase58());
});

test('accepted: no reference yields null so the caller makes one', () => {
  const r = readPayUrl(withAmount({ recipient, splToken: usdc }, '2'));
  assert.equal(r.ok, true);
  assert.equal(r.request.reference, null);
});

test('refused: not a Solana Pay URL', () => {
  assert.deepEqual(readPayUrl('https://example.test/pay'), { ok: false, reason: 'not a Solana Pay URL' });
  assert.deepEqual(readPayUrl('solana:not-a-key?amount=1'), { ok: false, reason: 'not a Solana Pay URL' });
});

test('refused: transaction request', () => {
  const url = encodeURL({ link: new URL('https://example.test/api/pay'), label: 'x' }).toString();
  assert.deepEqual(readPayUrl(url), { ok: false, reason: 'transaction requests are not supported' });
});

test('refused: SOL request (no spl-token)', () => {
  assert.deepEqual(readPayUrl(withAmount({ recipient, reference }, '1')), { ok: false, reason: 'SOL requests are not supported' });
});

test('refused: spl-token other than USDC', () => {
  assert.deepEqual(readPayUrl(withAmount({ recipient, splToken: otherMint, reference }, '1')), { ok: false, reason: 'only USDC requests are supported' });
});

test('refused: no amount', () => {
  assert.deepEqual(readPayUrl(withAmount({ recipient, splToken: usdc, reference })), { ok: false, reason: 'the request has no amount' });
});

test('refused: memo', () => {
  assert.deepEqual(readPayUrl(withAmount({ recipient, splToken: usdc, reference, memo: 'order 1' }, '1')), { ok: false, reason: 'requests with a memo are not supported' });
});

test('refused: more than one reference', () => {
  assert.deepEqual(readPayUrl(withAmount({ recipient, splToken: usdc, reference: [reference, reference2] }, '1')), {
    ok: false,
    reason: 'requests with more than one reference are not supported',
  });
});

test('merchant round trip: buildRequestUrl then parseURL keeps every field', () => {
  const url = buildRequestUrl(recipient, '1.5', reference);
  const p = parseURL(url);
  assert.equal(p.recipient.toBase58(), recipient.toBase58());
  assert.equal(p.amount.toFixed(), '1.5');
  assert.equal(p.splToken.toBase58(), USDC.mint);
  assert.equal(p.reference.length, 1);
  assert.equal(p.reference[0].toBase58(), reference.toBase58());
  assert.equal(p.label, REQUEST_LABEL);
  assert.equal(p.memo, undefined);
  assert.equal(readPayUrl(url).ok, true);
});

test('label: returned as plain text, cut to 64 characters, null when absent', () => {
  const short = readPayUrl(withAmount({ recipient, splToken: usdc, reference, label: 'Corner Coffee' }, '1'));
  assert.equal(short.ok, true);
  assert.equal(short.request.label, 'Corner Coffee');
  const long = readPayUrl(withAmount({ recipient, splToken: usdc, reference, label: 'x'.repeat(100) }, '1'));
  assert.equal(long.ok, true);
  assert.equal(long.request.label, 'x'.repeat(64));
  const none = readPayUrl(withAmount({ recipient, splToken: usdc, reference }, '1'));
  assert.equal(none.ok, true);
  assert.equal(none.request.label, null);
});

test('scan link: both layers decode back to the exact request URL and the ref is the origin', () => {
  const origin = 'https://stocksol.vercel.app';
  const requestUrl = buildRequestUrl(recipient, '1.5', reference);
  const link = buildScanLink(origin, requestUrl);
  const prefix = 'https://phantom.app/ul/browse/';
  assert.ok(link.startsWith(prefix));
  const rest = link.slice(prefix.length);
  const at = rest.indexOf('?ref=');
  assert.ok(at > 0);
  const payUrl = decodeURIComponent(rest.slice(0, at));
  assert.equal(decodeURIComponent(rest.slice(at + '?ref='.length)), origin);
  assert.ok(payUrl.startsWith(`${origin}/pay?link=`));
  assert.equal(new URL(payUrl).searchParams.get('link'), requestUrl);
  assert.equal(readPayUrl(new URL(payUrl).searchParams.get('link')).ok, true);
  assert.equal(new URL(link).searchParams.get('ref'), origin);
});

