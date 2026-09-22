// The only holdings allowlist in the app. Every holding, mint and route call comes from here.
// Mints are never taken from a wallet scan, from the Jupiter screener, or from any Jupiter tag:
// the PreStocks bounty makes a project ineligible if it integrates any non-PreStocks pre-IPO token.
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
  /** Issuer has set a date after which the token expires worthless; never offered on the pay screen. */
  expiring: boolean;
  /** Provenance weaker than the issuer API, or not yet routable; never offered on the pay screen. */
  hiddenUnlessRoutable: boolean;
};

// decimals and tokenProgram for every entry below come from the Jupiter Tokens API search of
// 19 Sep 2026: one GET https://api.jup.ag/tokens/v2/search with all eleven mints comma-separated.
// The same day each mint account was read with getMultipleAccounts and agreed on owner and decimals.

/** The payment mint. Not a holding: it is what holdings are sold for, never sold itself. */
export const USDC: RegistryEntry = {
  symbol: 'USDC',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  tokenProgram: TOKEN_PROGRAM,
  issuer: 'Circle',
  sourceUrl: 'https://api.jup.ag/tokens/v2/search?query=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  sourceDate: '19 Sep 2026',
  expiring: false,
  hiddenUnlessRoutable: false,
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
    expiring: false,
    hiddenUnlessRoutable: false,
  },

  // The nine PreStocks mints. All nine mint accounts were read on 19 Sep 2026 and share
  // mint authority and freeze authority WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc.
  {
    symbol: 'ANDURIL',
    mint: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'ANTHROPIC',
    mint: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'FIGUREAI',
    mint: 'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'KALSHI',
    mint: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'NEURALINK',
    mint: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'OPENAI',
    mint: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    symbol: 'POLYMARKET',
    mint: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: false,
  },
  {
    // prestocks.com/products (17 Sep 2026): these tokens must be swapped before 12 March 2027
    // or they expire worthless.
    symbol: 'SPACEX',
    mint: 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://prestocks.com/api/prestocks',
    sourceDate: '17 Sep 2026',
    expiring: true,
    hiddenUnlessRoutable: false,
  },
  {
    // Source is an explorer, not the issuer: on 17 Sep 2026 XAI was absent from the issuer API
    // response and from Jupiter's PreStocks screener. Its mint and freeze authority match the
    // value the other eight share (read on chain, 19 Sep 2026), so it stays in the registry,
    // but the weaker provenance keeps it off the pay screen.
    symbol: 'XAI',
    mint: 'PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
    decimals: 9,
    tokenProgram: TOKEN_2022_PROGRAM,
    issuer: 'PreStocks',
    sourceUrl: 'https://solscan.io/token/PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx',
    sourceDate: '17 Sep 2026',
    expiring: false,
    hiddenUnlessRoutable: true,
  },
];

/**
 * Symbols the pay screen offers in this lane. The PreStocks entries stay in the registry and are
 * quoted directly in step 10, but nothing but SPYx is payable until a lane widens this list.
 */
const OFFERED_SYMBOLS = ['SPYx'];

/** The only list the pay screen may offer, and the only mints /api/pay may accept as input. */
export function payableHoldings(): RegistryEntry[] {
  return HOLDINGS.filter(
    (h) => OFFERED_SYMBOLS.includes(h.symbol) && !h.expiring && !h.hiddenUnlessRoutable,
  );
}

export function findHolding(mint: string): RegistryEntry | undefined {
  return HOLDINGS.find((h) => h.mint === mint);
}

export function isPayableHoldingMint(mint: string): boolean {
  return payableHoldings().some((h) => h.mint === mint);
}
