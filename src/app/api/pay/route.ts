// Builds the payment transaction(s) for a payer: validates every input, checks the payer can cover
// SOL fees and rent, quotes and sizes the stock sale, assembles and simulates, and returns
// unsigned transactions for the wallet to sign.

import { Connection, PublicKey } from '@solana/web3.js';
import { ACCOUNT_SIZE, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { findHolding, isPayableHoldingMint, USDC } from '../../../registry';
import { buildSwapCovering, JupiterError, searchToken } from '../../../lib/jupiter';
import { assemble, AssembleError } from '../../../lib/assemble';
import {
  lamportShortfall,
  lamportsRequired,
  payerOutflow,
  SIGNATURE_FEE_LAMPORTS,
  solShortageReason,
  transactionCost,
  transactionFee,
} from '../../../lib/sol-budget';
import {
  parseAmountUsdc,
  parseReference,
  parseWalletAddress,
  plain,
  readJsonObject,
  ValidationError,
} from '../../../lib/validate';

export async function POST(req: Request): Promise<Response> {
  let input;
  try {
    const body = await readJsonObject(req);
    const payer = parseWalletAddress(body.payer, 'payer');
    const recipient = parseWalletAddress(body.recipient, 'recipient');
    if (recipient.equals(payer)) throw new ValidationError('recipient must differ from payer');
    const amountUsdc = parseAmountUsdc(body.amountUsdc);
    const reference = parseReference(body.reference, 'reference');
    const inMint = body.inMint;
    if (typeof inMint !== 'string' || !isPayableHoldingMint(inMint)) {
      throw new ValidationError('inMint is not a payable holding');
    }
    input = { payer, recipient, amountUsdc, reference, inMint };
  } catch (e) {
    if (e instanceof ValidationError) return plain(400, e.reason);
    return plain(500, 'internal error');
  }

  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) return plain(500, 'rpc not configured');
  const holding = findHolding(input.inMint);
  if (!holding) return plain(400, 'inMint is not a payable holding');
  const connection = new Connection(rpcUrl, 'confirmed');

  // SOL before anything upstream: one signature fee plus the rent-exempt reserve for the wallet.
  let balance: bigint;
  let reserve: bigint;
  try {
    balance = BigInt(await connection.getBalance(input.payer));
    reserve = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  } catch {
    return plain(502, 'rpc unavailable');
  }
  if (balance < SIGNATURE_FEE_LAMPORTS + reserve) {
    return plain(400, solShortageReason(SIGNATURE_FEE_LAMPORTS + reserve, balance));
  }

  try {
    const hit = await searchToken(input.inMint);
    if (hit.usdPrice === null || hit.usdPrice <= 0) return plain(502, 'price unavailable');
    // usdPrice treated as per unscaled token, as in the step 4 read; the sizing loop scales up
    // from here and any small overshoot stays with the payer as change.
    const indicativeIn = BigInt(
      Math.ceil((Number(input.amountUsdc) / 10 ** USDC.decimals / hit.usdPrice) * 10 ** holding.decimals),
    );
    const sizing = await buildSwapCovering(input.inMint, USDC.mint, input.amountUsdc, input.payer.toBase58(), indicativeIn);
    const swap = sizing.sized;

    let built;
    try {
      built = await assemble(connection, {
        payer: input.payer,
        recipient: input.recipient,
        amountUsdc: input.amountUsdc,
        reference: input.reference,
        swap,
      });
    } catch (e) {
      // A simulation that failed for lack of lamports is a SOL shortage, read from the log line only.
      const shortfall = e instanceof AssembleError ? lamportShortfall(e.logs) : null;
      if (shortfall !== null) return plain(400, solShortageReason(balance + shortfall + reserve, balance));
      throw e;
    }

    // What the whole payment needs: fees per transaction, what the swap-carrying transaction
    // moves out of the payer (second simulation returning the payer account), the payee's USDC
    // account rent on the two-transaction path when it does not exist yet, and the reserve.
    const costs = built.transactions.map(transactionCost);
    const swapTx = built.transactions[0];
    const sim = await connection.simulateTransaction(swapTx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { encoding: 'base64', addresses: [input.payer.toBase58()] },
    });
    const post = sim.value.accounts?.[0]?.lamports;
    if (sim.value.err !== null || typeof post !== 'number') {
      const shortfall = lamportShortfall(sim.value.logs);
      if (shortfall !== null) return plain(400, solShortageReason(balance + shortfall + reserve, balance));
      return plain(502, 'swap unavailable');
    }
    const swapOutflowLamports = payerOutflow(balance, BigInt(post), transactionFee(costs[0]));
    let payeeAccountMissing = false;
    let payeeAccountRentLamports = BigInt(0);
    if (!built.single) {
      const payeeAta = getAssociatedTokenAddressSync(new PublicKey(USDC.mint), input.recipient, false, TOKEN_PROGRAM_ID);
      payeeAccountMissing = (await connection.getAccountInfo(payeeAta)) === null;
      payeeAccountRentLamports = BigInt(await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE));
    }
    const budget = lamportsRequired({
      transactions: costs,
      swapOutflowLamports,
      payeeAccountMissing,
      payeeAccountRentLamports,
      reserveLamports: reserve,
    });
    if (balance < budget.total) return plain(400, solShortageReason(budget.total, balance));

    return Response.json({
      transactions: built.transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64')),
      sizes: built.sizes,
      single: built.single,
      route: swap.routeLabels,
      inAmount: swap.inAmount.toString(),
      outAmount: swap.outAmount.toString(),
      otherAmountThreshold: swap.otherAmountThreshold.toString(),
      lamportsRequired: budget.total.toString(),
      lamportsBreakdown: {
        fees: budget.fees.toString(),
        swapOutflow: budget.swapOutflow.toString(),
        payeeAccountRent: budget.payeeAccountRent.toString(),
        reserve: budget.reserve.toString(),
      },
      payerLamports: balance.toString(),
    });
  } catch (e) {
    if (e instanceof JupiterError && e.status === 429) return plain(503, 'busy, try again');
    if (e instanceof JupiterError || e instanceof AssembleError) return plain(502, 'swap unavailable');
    return plain(500, 'internal error');
  }
}
