// Confirms a payment by reading the transaction and running the app's own verifier.

import { Connection } from '@solana/web3.js';
import { verifyPayment } from '../../../lib/verify';
import {
  parseAmountUsdc,
  parseReference,
  parseSignature,
  parseWalletAddress,
  plain,
  readJsonObject,
  ValidationError,
} from '../../../lib/validate';

export async function POST(req: Request): Promise<Response> {
  let input;
  try {
    const body = await readJsonObject(req);
    input = {
      signature: parseSignature(body.signature),
      recipient: parseWalletAddress(body.recipient, 'recipient'),
      amountUsdc: parseAmountUsdc(body.amountUsdc),
      reference: parseReference(body.reference, 'reference'),
    };
  } catch (e) {
    if (e instanceof ValidationError) return plain(400, e.reason);
    return plain(500, 'internal error');
  }

  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) return plain(500, 'rpc not configured');

  let parsed;
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    parsed = await connection.getParsedTransaction(input.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
  } catch {
    return plain(502, 'rpc unavailable');
  }
  if (parsed === null) return plain(404, 'not found yet');

  const { signature, ...expected } = input;
  const result = verifyPayment(parsed, expected);
  return Response.json({ signature, ...result });
}
