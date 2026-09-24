// The receipt after a verified payment, from the confirmed transactions' token balances. Pure over
// the getParsedTransaction shape; a missing pre-balance counts as zero, so does a missing post.

export type TokenBalanceEntry = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

export type ReceiptTransaction = {
  meta: {
    fee: number;
    preTokenBalances?: TokenBalanceEntry[] | null;
    postTokenBalances?: TokenBalanceEntry[] | null;
  } | null;
};

export type ReceiptInput = {
  /** Single path: [payment]. Split path: [sale, payment]. */
  transactions: ReceiptTransaction[];
  single: boolean;
  payer: string;
  recipient: string;
  holdingMint: string;
  usdcMint: string;
  amountUsdc: bigint;
  holdingDecimals: number;
  /** The holding's scaled-UI multiplier, so the price is per unit as the quote shows it. */
  multiplier: number;
};

export type Receipt = {
  sold: bigint;
  got: bigint;
  paid: bigint;
  kept: bigint;
  fees: bigint;
  /** USDC per holding unit in scaled units, 2 decimals; null when nothing was sold. */
  pricePerUnit: string | null;
};

const raw = (e: TokenBalanceEntry | undefined): bigint =>
  e && /^\d+$/.test(e.uiTokenAmount.amount) ? BigInt(e.uiTokenAmount.amount) : BigInt(0);

/** Change of `owner`'s balance in `mint` across one transaction (post minus pre, summed over accounts). */
export function balanceChange(tx: ReceiptTransaction, owner: string, mint: string): bigint {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const indexes = new Set<number>();
  for (const e of [...pre, ...post]) if (e.owner === owner && e.mint === mint) indexes.add(e.accountIndex);
  let change = BigInt(0);
  for (const i of indexes) {
    change += raw(post.find((e) => e.accountIndex === i)) - raw(pre.find((e) => e.accountIndex === i));
  }
  return change;
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const sale = input.transactions[0];
  const payment = input.transactions[input.transactions.length - 1];
  const sold = -balanceChange(sale, input.payer, input.holdingMint);
  const got = input.single
    ? balanceChange(payment, input.payer, input.usdcMint) + input.amountUsdc
    : balanceChange(sale, input.payer, input.usdcMint);
  const paid = balanceChange(payment, input.recipient, input.usdcMint);
  const fees = input.transactions.reduce((sum, tx) => sum + BigInt(tx.meta?.fee ?? 0), BigInt(0));
  const soldUnits = (Number(sold) / 10 ** input.holdingDecimals) * input.multiplier;
  const pricePerUnit = sold > BigInt(0) ? (Number(got) / 1e6 / soldUnits).toFixed(2) : null;
  return { sold, got, paid, kept: got - paid, fees, pricePerUnit };
}
