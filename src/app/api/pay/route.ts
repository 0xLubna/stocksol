// Builds the payment transaction(s) for a payer: validates every input, quotes and sizes the
// stock sale, assembles and simulates, and returns unsigned transactions for the wallet to sign.

import { Connection } from '@solana/web3.js';
import { findHolding, isPayableHoldingMint, USDC } from '../../../registry';
import { buildSwapCovering, JupiterError, searchToken } from '../../../lib/jupiter';
import { assemble, AssembleError } from '../../../lib/assemble';
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

    const connection = new Connection(rpcUrl, 'confirmed');
    const built = await assemble(connection, {
      payer: input.payer,
      recipient: input.recipient,
      amountUsdc: input.amountUsdc,
      reference: input.reference,
      swap,
    });

    return Response.json({
      transactions: built.transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64')),
      sizes: built.sizes,
      single: built.single,
      route: swap.routeLabels,
      inAmount: swap.inAmount.toString(),
      outAmount: swap.outAmount.toString(),
      otherAmountThreshold: swap.otherAmountThreshold.toString(),
    });
  } catch (e) {
    if (e instanceof JupiterError && e.status === 429) return plain(503, 'busy, try again');
    if (e instanceof JupiterError || e instanceof AssembleError) return plain(502, 'swap unavailable');
    return plain(500, 'internal error');
  }
}
