// The only holdings allowlist in the app. Every holding, mint and route call comes from here.
// Mints are never taken from a wallet scan, from the Jupiter screener, or from any Jupiter tag
// (GET /tokens/v2/tag?query=stocks answers "Invalid tag provided" in any case - of the five tags
// tried on 19 Sep 2026, only `verified` and `lst` were accepted - so the `tags` field is reporting
// only, never a reason to include.)

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type RegistryEntry = {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
  issuer: string;
  sourceUrl: string;
  sourceDate: string;
};

// decimals and tokenProgram for USDC and SPYx come from the Jupiter Tokens API search of
// 19 Sep 2026: one GET https://api.jup.ag/tokens/v2/search.
// The same day each mint account was read with getMultipleAccounts and agreed on owner and decimals.
// NVDAx and TSLAx: the same search on 25 Sep 2026, agreed the same day with a getAccountInfo read
// of each mint on owner program and decimals.

/** The payment mint. Not a holding: it is what holdings are sold for, never sold itself. */
export const USDC: RegistryEntry = {
  symbol: 'USDC',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  tokenProgram: TOKEN_PROGRAM,
  issuer: 'Circle',
  sourceUrl: 'https://api.jup.ag/tokens/v2/search?query=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  sourceDate: '19 Sep 2026',
};

export const HOLDINGS: RegistryEntry[] = [
  {
    symbol: 'SPYx',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    decimals: 8,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'xStocks',
    sourceUrl: 'https://api.jup.ag/tokens/v2/search?query=SPYx',
    sourceDate: '19 Sep 2026',
  },
  {
    symbol: 'NVDAx',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    decimals: 8,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'xStocks',
    sourceUrl: 'https://api.jup.ag/tokens/v2/search?query=NVDAx',
    sourceDate: '25 Sep 2026',
  },
  {
    symbol: 'TSLAx',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    decimals: 8,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'xStocks',
    sourceUrl: 'https://api.jup.ag/tokens/v2/search?query=TSLAx',
    sourceDate: '25 Sep 2026',
  },
];

/**
 * Symbols the pay screen offers.
 */
const OFFERED_SYMBOLS = ['SPYx', 'NVDAx', 'TSLAx'];

/** The only list the pay screen may offer, and the only mints /api/pay may accept as input. */
export function payableHoldings(): RegistryEntry[] {
  return HOLDINGS.filter(
    (h) => OFFERED_SYMBOLS.includes(h.symbol),
  );
}

export function findHolding(mint: string): RegistryEntry | undefined {
  return HOLDINGS.find((h) => h.mint === mint);
}

export function isPayableHoldingMint(mint: string): boolean {
  return payableHoldings().some((h) => h.mint === mint);
}
