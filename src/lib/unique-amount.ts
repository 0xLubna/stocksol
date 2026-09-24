// The merchant's unique amount: the entered amount plus k millionths of a USDC, k from 1 to 999,
// so a payment made without the reference can still be recognised by its amount.

import { USDC } from '../registry';
import { parseAmountUsdc, ValidationError } from './validate';

export const UNIQUE_MIN = 1;
export const UNIQUE_MAX = 999;

/** Raw USDC units as decimal text, trailing zeros trimmed. */
export function formatUsdc(raw: bigint): string {
  const scale = BigInt(10) ** BigInt(USDC.decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(USDC.decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

/** The entered amount plus k millionths; the result must pass the same rules and cap as /api/pay. */
export function uniqueAmount(amountText: string, k: number): string {
  if (!Number.isInteger(k) || k < UNIQUE_MIN || k > UNIQUE_MAX) throw new ValidationError('unique amount step out of range');
  const text = formatUsdc(parseAmountUsdc(amountText) + BigInt(k));
  parseAmountUsdc(text);
  return text;
}

/** k drawn with crypto.getRandomValues, 1 to 999. */
export function drawUniqueStep(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return UNIQUE_MIN + (word[0] % (UNIQUE_MAX - UNIQUE_MIN + 1));
}
