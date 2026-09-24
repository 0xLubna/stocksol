// Reads a Solana Pay URL for the pay page. Pure; every refusal is a fixed reason and the library's
// own error text never reaches the screen.

import { PublicKey } from '@solana/web3.js';
import { encodeURL, parseURL } from '@solana/pay';
import { USDC } from '../registry';

export const REQUEST_LABEL = 'StockPay';
const PHANTOM_BROWSE = 'https://phantom.app/ul/browse/';

/**
 * A link a phone camera opens in Phantom's in-app browser on this site's pay page with the request
 * URL as ?link=. Both layers are URL-encoded: the pay URL inside the Phantom link, and the request
 * URL inside the pay URL.
 */
export function buildScanLink(origin: string, requestUrl: string): string {
  const payUrl = `${origin}/pay?link=${encodeURIComponent(requestUrl)}`;
  return `${PHANTOM_BROWSE}${encodeURIComponent(payUrl)}?ref=${encodeURIComponent(origin)}`;
}

/** The merchant's transfer-request URL for USDC with one reference and the amount as decimal text. */
export function buildRequestUrl(recipient: PublicKey, amountText: string, reference: PublicKey): string {
  // encodeURL's amount type is bignumber.js, which is not an approved dependency; the amount is
  // set on the URL as the decimal string the Solana Pay transfer request format carries.
  const url = encodeURL({ recipient, splToken: new PublicKey(USDC.mint), reference, label: REQUEST_LABEL });
  url.searchParams.set('amount', amountText);
  return url.toString();
}

export type PayRequest = {
  recipient: PublicKey;
  /** Decimal text as the URL carries it; the caller applies the amount rules. */
  amountText: string;
  /** The URL's single reference, or null when it has none and the caller must make one. */
  reference: PublicKey | null;
  /** The URL's label as plain text cut to 64 characters, or null. */
  label: string | null;
};

export const LABEL_MAX_CHARS = 64;

export type PayUrlResult = { ok: true; request: PayRequest } | { ok: false; reason: string };

export function readPayUrl(text: string): PayUrlResult {
  let parsed: ReturnType<typeof parseURL>;
  try {
    parsed = parseURL(text.trim());
  } catch {
    return { ok: false, reason: 'not a Solana Pay URL' };
  }
  if ('link' in parsed) return { ok: false, reason: 'transaction requests are not supported' };
  if (!parsed.splToken) return { ok: false, reason: 'SOL requests are not supported' };
  if (parsed.splToken.toBase58() !== USDC.mint) return { ok: false, reason: 'only USDC requests are supported' };
  if (!parsed.amount) return { ok: false, reason: 'the request has no amount' };
  if (parsed.memo !== undefined) return { ok: false, reason: 'requests with a memo are not supported' };
  if (parsed.reference && parsed.reference.length > 1) {
    return { ok: false, reason: 'requests with more than one reference are not supported' };
  }
  return {
    ok: true,
    request: {
      recipient: parsed.recipient,
      amountText: parsed.amount.toFixed(),
      reference: parsed.reference?.[0] ?? null,
      label: typeof parsed.label === 'string' && parsed.label.length > 0 ? parsed.label.slice(0, LABEL_MAX_CHARS) : null,
    },
  };
}
