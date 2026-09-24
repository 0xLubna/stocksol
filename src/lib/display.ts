// Display helpers for the pages. Every amount in code stays raw; these only format for the screen.

export type ScaledUiAmountConfig = {
  multiplier: string;
  newMultiplier: string;
  newMultiplierEffectiveTimestamp: number;
};

/** multiplier before newMultiplierEffectiveTimestamp, newMultiplier at or after it. */
export function currentMultiplier(config: ScaledUiAmountConfig, nowSeconds: number): number {
  const chosen = nowSeconds >= config.newMultiplierEffectiveTimestamp ? config.newMultiplier : config.multiplier;
  const value = Number(chosen);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** raw / 10^decimals x multiplier, as text. */
export function formatScaled(raw: bigint, decimals: number, multiplier: number): string {
  return ((Number(raw) / 10 ** decimals) * multiplier).toFixed(decimals);
}
