'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import QRCode from 'qrcode';
import Providers from '../providers';
import { USDC } from '../../registry';
import { matchAmount } from '../../lib/amount-match';
import {
  AMOUNT_MAX_PAGES_PER_POLL,
  AMOUNT_MAX_READS_PER_POLL,
  AMOUNT_PAGE_LIMIT,
  applyPage,
  MANY_TRANSACTIONS_TEXT,
  nextToVerify,
  pageRequest,
  passInProgress,
  queueIsLong,
} from '../../lib/amount-watch';
import {
  applyAmountOutcome,
  applyOutcome,
  MERCHANT_LOOKUP_LIMIT,
  MISMATCH_TEXT,
  newWatch,
  pollInterval,
  selectToVerify,
  skipSet,
  SLOW_AFTER_MS,
  SLOW_TEXT,
  storeWatch,
  watchFor,
  withAmountWatch,
  type StoredWatch,
  type WatchOutcome,
  type WatchState,
} from '../../lib/merchant-watch';
import { buildRequestUrl, buildScanLink } from '../../lib/pay-url';
import { drawUniqueStep, uniqueAmount } from '../../lib/unique-amount';
import { parseAmountUsdc, parseWalletAddress, ValidationError } from '../../lib/validate';

// Watching as built: both paths every 3 s for 10 minutes, then every 30 s for as long as the page
// is open; a transfer request has no deadline, so it is never declared unpaid or expired.
const UNIQUE_TEXT = 'Includes a few millionths so this payment can be recognised.';
const NETWORK_BUSY = 'network busy, try again';
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Request = { recipient: PublicKey; recipientAta: PublicKey; amountText: string; amountUsdc: bigint; reference: PublicKey; url: string; createdAt: number };
type Paid = { signature: string; foundBy: 'reference' | 'amount' };

function MerchantPage() {
  const { connection } = useConnection();
  const [addressText, setAddressText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [request, setRequest] = useState<Request | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [scanQr, setScanQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [paid, setPaid] = useState<Paid | null>(null);
  const [creating, setCreating] = useState(false);
  // The watch state belongs to one reference; a round for an older request reads and writes nothing.
  const watch = useRef<StoredWatch | null>(null);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    setPaid(null);
    setQr(null);
    setScanQr(null);
    setRequest(null);
    try {
      const recipient = parseWalletAddress(addressText.trim(), 'recipient');
      // The entered amount plus 1 to 999 millionths, under the same rules and cap as /api/pay.
      const text = uniqueAmount(amountText.trim(), drawUniqueStep());
      const amountUsdc = parseAmountUsdc(text);
      const recipientAta = getAssociatedTokenAddressSync(new PublicKey(USDC.mint), recipient, false, TOKEN_PROGRAM_ID);
      // The boundary: the newest signature on the recipient's USDC account right now; the amount
      // path looks at nothing older. Without it there is no request.
      let boundary: string | null;
      try {
        const newest = await connection.getSignaturesForAddress(recipientAta, { limit: 1 }, 'confirmed');
        boundary = newest.length > 0 ? newest[0].signature : null;
      } catch {
        setError(NETWORK_BUSY);
        return;
      }
      // A fresh reference per request; it is never reused once a payment is found.
      const reference = Keypair.generate().publicKey;
      watch.current = newWatch(reference.toBase58(), boundary);
      const href = buildRequestUrl(recipient, text, reference);
      setRequest({ recipient, recipientAta, amountText: text, amountUsdc, reference, url: href, createdAt: Date.now() });
      setQr(await QRCode.toDataURL(href, { width: 320, margin: 1 }));
      setScanQr(await QRCode.toDataURL(buildScanLink(window.location.origin, href), { width: 320, margin: 1 }));
      setStatus('waiting for payment');
    } catch (e) {
      setError(e instanceof ValidationError ? e.reason : 'could not create the request');
    } finally {
      setCreating(false);
    }
  };

  // One verifier call as an outcome. Never throws.
  const verifyOnce = async (signature: string, r: Request): Promise<WatchOutcome> => {
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature, recipient: r.recipient.toBase58(), amountUsdc: r.amountText, reference: r.reference.toBase58() }),
      });
      if (res.status !== 200) return { kind: 'response', status: res.status, ok: false };
      const body = await res.json();
      return { kind: 'response', status: 200, ok: body.ok === true };
    } catch {
      return { kind: 'threw' };
    }
  };

  // One round of both paths. Reference path: signatures for the reference (errors skipped), the
  // newest unrejected ones verified, at most 5. Amount path: every signature on the recipient's
  // USDC account since the boundary collected page by page (at most 5 pages a round, the position
  // carried over), then at most 5 read and matched oldest first. Nothing is skipped; a read that
  // fails is retried next round.
  const pollOnce = async (r: Request): Promise<WatchState> => {
    const reference = r.reference.toBase58();
    let state = watchFor(watch.current, reference);
    const commit = () => {
      watch.current = storeWatch(watch.current, reference, state);
    };

    try {
      const entries = await connection.getSignaturesForAddress(r.reference, { limit: MERCHANT_LOOKUP_LIMIT }, 'confirmed');
      for (const signature of selectToVerify(entries, skipSet(state))) {
        state = applyOutcome(state, signature, await verifyOnce(signature, r));
        commit();
        if (state.paid) return state;
      }
    } catch {
      // the reference lookup is retried next round
    }

    try {
      let pages = 0;
      do {
        const req = pageRequest(state.amount);
        const page = await connection.getSignaturesForAddress(
          r.recipientAta,
          { limit: AMOUNT_PAGE_LIMIT, until: req.until ?? undefined, before: req.before ?? undefined },
          'confirmed',
        );
        state = withAmountWatch(state, applyPage(state.amount, page, skipSet(state)));
        commit();
        pages += 1;
      } while (passInProgress(state.amount) && pages < AMOUNT_MAX_PAGES_PER_POLL);
    } catch {
      // the collection pass carries on from its position next round
    }

    for (const signature of nextToVerify(state.amount, AMOUNT_MAX_READS_PER_POLL)) {
      let outcome: 'paid' | 'nomatch' | 'error';
      try {
        const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) outcome = 'error';
        else outcome = matchAmount(tx, { recipient: r.recipient.toBase58(), recipientAta: r.recipientAta.toBase58(), usdcMint: USDC.mint, amountUsdc: r.amountUsdc }).ok ? 'paid' : 'nomatch';
      } catch {
        outcome = 'error';
      }
      state = applyAmountOutcome(state, signature, outcome);
      commit();
      if (state.paid) return state;
    }
    return state;
  };

  useEffect(() => {
    if (!request || paid) return;
    let cancelled = false;
    (async () => {
      for (;;) {
        const state = await pollOnce(request);
        if (cancelled) return;
        if (state.paid && state.foundBy) {
          setPaid({ signature: state.paid, foundBy: state.foundBy });
          return;
        }
        const elapsed = Date.now() - request.createdAt;
        if (elapsed >= SLOW_AFTER_MS) setStatus(SLOW_TEXT);
        else if (queueIsLong(state.amount)) setStatus(MANY_TRANSACTIONS_TEXT);
        else if (state.mismatch) setStatus(MISMATCH_TEXT);
        await sleep(pollInterval(elapsed));
      }
    })();
    return () => {
      cancelled = true;
    };
    // pollOnce reads the request and the watch ref; the request is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, request, paid]);

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Merchant</h1>
      <p>Create a USDC payment request; the payer settles it from stock holdings in one transaction when it fits, or two.</p>
      <label>
        Recipient address
        <input value={addressText} onChange={(e) => setAddressText(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        Amount (USDC)
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="1.50" style={{ width: '100%' }} />
      </label>
      <div style={{ marginTop: '1rem' }}>
        <button onClick={create} disabled={creating}>
          Create request
        </button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {request && (
        <section style={{ marginTop: '1rem' }}>
          <p>
            Amount to pay: {request.amountText} USDC. {UNIQUE_TEXT}
          </p>
          {qr && <img src={qr} alt="Solana Pay QR" width={320} height={320} />}
          <p style={{ wordBreak: 'break-all', fontSize: 12 }}>{request.url}</p>
          <p>Reference: {request.reference.toBase58()}</p>
          {scanQr && (
            <>
              <img src={scanQr} alt="Scan to pay QR" width={320} height={320} />
              <p>Scan with your phone camera to pay from stock in Phantom</p>
            </>
          )}
          {paid ? (
            <p style={{ color: 'green' }}>
              Paid{' '}
              <a href={explorer(paid.signature)} target="_blank" rel="noreferrer">
                {paid.signature}
              </a>{' '}
              ({paid.foundBy === 'reference' ? 'found by reference' : 'found by amount'})
            </p>
          ) : (
            <p>{status}</p>
          )}
        </section>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Providers>
      <MerchantPage />
    </Providers>
  );
}
