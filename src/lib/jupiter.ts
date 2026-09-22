// The one swap interface. Jupiter Router GET /swap/v2/build only, called with fetch from the
// server; the key comes from the environment and never leaves this module.

import { PublicKey } from '@solana/web3.js';

const BUILD_URL = 'https://api.jup.ag/swap/v2/build';
const SEARCH_URL = 'https://api.jup.ag/tokens/v2/search';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

/** Compute-unit price ceiling: 1 lamport per unit, so 1,400,000 units cost at most 0.0014 SOL. */
export const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = BigInt(1_000_000);
export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_MAX_ACCOUNTS = 64;
const MIN_CALL_SPACING_MS = 2000;

export type JupiterAccountMeta = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type JupiterInstruction = { programId: string; accounts: JupiterAccountMeta[]; data: string };

export type SwapInstructions = {
  inAmount: bigint;
  outAmount: bigint;
  otherAmountThreshold: bigint;
  routeLabels: string[];
  computeBudgetInstructions: JupiterInstruction[];
  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction: JupiterInstruction | null;
  otherInstructions: JupiterInstruction[];
  addressesByLookupTableAddress: Record<string, string[]>;
  blockhash: string;
  lastValidBlockHeight: number | null;
  /** From computeBudgetInstructions; null when /build sent none. */
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: bigint | null;
  /** The price as /build sent it, before the clamp. */
  computeUnitPriceMicroLamportsRaw: bigint | null;
};

export class JupiterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'JupiterError';
  }
}

let lastCallAt = 0;
async function spaced(): Promise<void> {
  const wait = lastCallAt + MIN_CALL_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

function apiKey(): string {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new JupiterError('JUPITER_API_KEY not set', null);
  return key;
}

// Jupiter error bodies carry a short `error` string; that field alone is surfaced, never the body.
async function jupiterGet(url: URL): Promise<unknown> {
  await spaced();
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'x-api-key': apiKey() }, cache: 'no-store' });
  } catch {
    throw new JupiterError('jupiter unreachable', null);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error.slice(0, 200)
        : '';
    throw new JupiterError(`jupiter ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  return body;
}

function isInstruction(v: unknown): v is JupiterInstruction {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Record<string, unknown>;
  return typeof i.programId === 'string' && Array.isArray(i.accounts) && typeof i.data === 'string';
}

function instructionList(v: unknown, field: string): JupiterInstruction[] {
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every(isInstruction)) {
    throw new JupiterError(`build response: ${field} is not an instruction list`, null);
  }
  return v;
}

function bigintField(v: unknown, field: string): bigint {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v);
  throw new JupiterError(`build response: ${field} missing or not an integer`, null);
}

function decodeComputeBudget(ixs: JupiterInstruction[]): {
  limit: number | null;
  price: bigint | null;
} {
  let limit: number | null = null;
  let price: bigint | null = null;
  for (const ix of ixs) {
    if (ix.programId !== COMPUTE_BUDGET_PROGRAM) continue;
    const data = Buffer.from(ix.data, 'base64');
    if (data.length === 5 && data[0] === 2) limit = data.readUInt32LE(1);
    if (data.length === 9 && data[0] === 3) price = data.readBigUInt64LE(1);
  }
  return { limit, price };
}

function routeLabels(routePlan: unknown): string[] {
  if (!Array.isArray(routePlan)) return [];
  return routePlan.map((leg) => {
    const l = leg as { swapInfo?: { label?: unknown }; label?: unknown };
    const label = l.swapInfo?.label ?? l.label;
    return typeof label === 'string' ? label : 'unknown';
  });
}

export type BuildOptions = { slippageBps?: number; maxAccounts?: number };

export async function getSwapInstructions(
  inMint: string,
  outMint: string,
  amount: bigint,
  taker: string,
  options: BuildOptions = {},
): Promise<SwapInstructions> {
  const url = new URL(BUILD_URL);
  url.searchParams.set('inputMint', inMint);
  url.searchParams.set('outputMint', outMint);
  url.searchParams.set('amount', amount.toString());
  url.searchParams.set('taker', taker);
  url.searchParams.set('slippageBps', String(options.slippageBps ?? DEFAULT_SLIPPAGE_BPS));
  url.searchParams.set('maxAccounts', String(options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS));

  const body = await jupiterGet(url);
  if (typeof body !== 'object' || body === null) {
    throw new JupiterError('build response: not an object', null);
  }
  const b = body as Record<string, unknown>;

  const swapInstruction = b.swapInstruction;
  if (!isInstruction(swapInstruction)) {
    throw new JupiterError('build response: swapInstruction missing', null);
  }
  const cleanup = b.cleanupInstruction;
  if (cleanup != null && !isInstruction(cleanup)) {
    throw new JupiterError('build response: cleanupInstruction malformed', null);
  }

  const tables = b.addressesByLookupTableAddress ?? {};
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) {
    throw new JupiterError('build response: addressesByLookupTableAddress malformed', null);
  }
  const addressesByLookupTableAddress: Record<string, string[]> = {};
  for (const [table, addresses] of Object.entries(tables)) {
    if (!Array.isArray(addresses) || !addresses.every((a) => typeof a === 'string')) {
      throw new JupiterError('build response: lookup table addresses malformed', null);
    }
    addressesByLookupTableAddress[table] = addresses;
  }

  const meta = b.blockhashWithMetadata as { blockhash?: unknown; lastValidBlockHeight?: unknown } | undefined;
  const bytes = meta?.blockhash;
  if (!Array.isArray(bytes) || bytes.length !== 32 || !bytes.every((x) => Number.isInteger(x))) {
    throw new JupiterError('build response: blockhashWithMetadata.blockhash is not 32 bytes', null);
  }
  const blockhash = new PublicKey(Uint8Array.from(bytes as number[])).toBase58();
  const lastValidBlockHeight =
    typeof meta?.lastValidBlockHeight === 'number' ? meta.lastValidBlockHeight : null;

  const computeBudgetInstructions = instructionList(b.computeBudgetInstructions, 'computeBudgetInstructions');
  const { limit, price } = decodeComputeBudget(computeBudgetInstructions);

  return {
    inAmount: bigintField(b.inAmount, 'inAmount'),
    outAmount: bigintField(b.outAmount, 'outAmount'),
    otherAmountThreshold: bigintField(b.otherAmountThreshold, 'otherAmountThreshold'),
    routeLabels: routeLabels(b.routePlan),
    computeBudgetInstructions,
    setupInstructions: instructionList(b.setupInstructions, 'setupInstructions'),
    swapInstruction,
    cleanupInstruction: cleanup == null ? null : cleanup,
    otherInstructions: instructionList(b.otherInstructions, 'otherInstructions'),
    addressesByLookupTableAddress,
    blockhash,
    lastValidBlockHeight,
    computeUnitLimit: limit,
    computeUnitPriceMicroLamports:
      price === null ? null : price > MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS ? MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS : price,
    computeUnitPriceMicroLamportsRaw: price,
  };
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}

export type SizedSwap = { indicative: SwapInstructions; sized: SwapInstructions; builds: number };

/**
 * ExactIn sizing: an indicative build with a guessed input, then the input scaled by
 * targetOut / otherAmountThreshold until the post-slippage minimum covers targetOut. At most
 * three builds; throws if the last one still falls short.
 */
export async function buildSwapCovering(
  inMint: string,
  outMint: string,
  targetOut: bigint,
  taker: string,
  indicativeIn: bigint,
  options: BuildOptions = {},
): Promise<SizedSwap> {
  const indicative = await getSwapInstructions(inMint, outMint, indicativeIn, taker, options);
  let sized = indicative;
  let builds = 1;
  while (sized.otherAmountThreshold < targetOut && builds < 3) {
    const nextIn = ceilDiv(sized.inAmount * targetOut, sized.otherAmountThreshold);
    sized = await getSwapInstructions(inMint, outMint, nextIn, taker, options);
    builds += 1;
  }
  if (sized.otherAmountThreshold < targetOut) {
    throw new JupiterError('sizing: post-slippage minimum still below the target after 3 builds', null);
  }
  return { indicative, sized, builds };
}

export type TokenSearchHit = { usdPrice: number | null; decimals: number | null; fields: string[] };

/** One Tokens API search for a mint; returns usdPrice and decimals of the hit whose id is the mint. */
export async function searchToken(mint: string): Promise<TokenSearchHit> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('query', mint);
  const body = await jupiterGet(url);
  if (!Array.isArray(body)) throw new JupiterError('search response: not a list', null);
  const hit = body.find((t) => typeof t === 'object' && t !== null && (t as { id?: unknown }).id === mint) as
    | Record<string, unknown>
    | undefined;
  if (!hit) throw new JupiterError('search response: mint not in results', null);
  return {
    usdPrice: typeof hit.usdPrice === 'number' ? hit.usdPrice : null,
    decimals: typeof hit.decimals === 'number' ? hit.decimals : null,
    fields: Object.keys(hit),
  };
}
