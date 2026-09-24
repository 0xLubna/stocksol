// Input validation shared by /api/pay and /api/verify. Every check runs before any upstream call
// and every failure is a fixed plain reason, never an upstream or library message.

import { PublicKey } from '@solana/web3.js';
import { USDC } from '../registry';

/** Largest payment this deployment builds, in raw USDC units: 25 USDC. Amounts must be below it. */
export const AMOUNT_CAP_USDC_RAW = BigInt(25_000_000);

export class ValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ValidationError';
  }
}

/** A base58 32-byte key that is on the ed25519 curve, so it can own token accounts. */
export function parseWalletAddress(value: unknown, field: string): PublicKey {
  const key = parseReference(value, field);
  if (!PublicKey.isOnCurve(key.toBytes())) throw new ValidationError(`${field} is not a wallet address`);
  return key;
}

// Length caps run before any decoding: a 32-byte key is at most 44 base58 characters and a
// 64-byte signature at most 88. Under the 25 USDC cap a valid amount is at most 9 characters
// ("24.999999"); 16 is headroom.
const MAX_PUBLIC_KEY_CHARS = 44;
const MAX_SIGNATURE_CHARS = 88;
const MAX_AMOUNT_CHARS = 16;

/** Any base58 32-byte key; the Solana Pay reference need not be on the curve. */
export function parseReference(value: unknown, field: string): PublicKey {
  if (typeof value !== 'string' || value.length === 0) throw new ValidationError(`${field} missing`);
  if (value.length > MAX_PUBLIC_KEY_CHARS) throw new ValidationError(`${field} is not a valid public key`);
  try {
    return new PublicKey(value);
  } catch {
    throw new ValidationError(`${field} is not a valid public key`);
  }
}

// A decimal string with at most USDC.decimals fractional digits, converted without floating point.
const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;

export function parseAmountUsdc(value: unknown): bigint {
  if (typeof value !== 'string') throw new ValidationError('amountUsdc must be a decimal string');
  if (value.length > MAX_AMOUNT_CHARS) {
    throw new ValidationError('amountUsdc must be a decimal with at most 6 decimals');
  }
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) throw new ValidationError('amountUsdc must be a decimal with at most 6 decimals');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(USDC.decimals, '0'));
  const raw = whole * BigInt(10) ** BigInt(USDC.decimals) + fraction;
  if (raw <= BigInt(0)) throw new ValidationError('amountUsdc must be above zero');
  if (raw >= AMOUNT_CAP_USDC_RAW) throw new ValidationError('amountUsdc is above the cap');
  return raw;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Minimal base58 decode for signature checks; web3.js only exposes decoding through PublicKey.
export function decodeBase58(value: string): Uint8Array {
  let n = BigInt(0);
  for (const ch of value) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) throw new ValidationError('not base58');
    n = n * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n % BigInt(256)));
    n /= BigInt(256);
  }
  let leading = 0;
  while (leading < value.length && value[leading] === '1') leading += 1;
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...bytes]);
}

/** A transaction signature: base58 text decoding to exactly 64 bytes. */
export function parseSignature(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new ValidationError('signature missing');
  if (value.length > MAX_SIGNATURE_CHARS) throw new ValidationError('signature is not 64 bytes');
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    throw new ValidationError('signature is not base58');
  }
  if (bytes.length !== 64) throw new ValidationError('signature is not 64 bytes');
  return value;
}

export function plain(status: number, reason: string): Response {
  return new Response(reason, { status, headers: { 'content-type': 'text/plain' } });
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('invalid json');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('json object expected');
  }
  return body as Record<string, unknown>;
}
