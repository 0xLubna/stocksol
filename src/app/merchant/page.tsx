'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Keypair, type PublicKey } from '@solana/web3.js';
import QRCode from 'qrcode';
import Providers from '../providers';
import {
  applyOutcome,
  isCurrent,
  MERCHANT_LOOKUP_LIMIT,
  MISMATCH_TEXT,
  newWatch,
  selectToVerify,
  storeWatch,
  watchFor,
  type StoredWatch,
  type WatchOutcome,
  type WatchState,
} from '../../lib/merchant-watch';
import { buildRequestUrl, buildScanLink } from '../../lib/pay-url';
import { parseAmountUsdc, parseWalletAddress, ValidationError } from '../../lib/validate';

// Polling as built: the reference every 3 s for 10 minutes, at most 5 verify calls per poll;
// then the request expires and "Check again" runs one more full round.
const REFERENCE_POLL_MS = 3000;
const REFERENCE_LIMIT_MS = 600_000;
const EXPIRED_TEXT = 'request expired, create a new one';
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Request = { recipient: PublicKey; amountText: string; reference: PublicKey; url: string };

function MerchantPage() {
  const { connection } = useConnection();
  const [addressText, setAddressText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [request, setRequest] = useState<Request | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [scanQr, setScanQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [paid, setPaid] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [checking, setChecking] = useState(false);
  // The watch state belongs to one reference; a round for an older request reads and writes nothing.
  const watch = useRef<StoredWatch | null>(null);

  const create = async () => {
    setError(null);
    setPaid(null);
    setExpired(false);
    setQr(null);
    setScanQr(null);
    try {
      const recipient = parseWalletAddress(addressText.trim(), 'recipient');
      const text = amountText.trim();
      parseAmountUsdc(text);
      // A fresh reference per request; it is never reused once a payment is found.
      const reference = Keypair.generate().publicKey;
      watch.current = newWatch(reference.toBase58());
      const href = buildRequestUrl(recipient, text, reference);
      setRequest({ recipient, amountText: text, reference, url: href });
      setQr(await QRCode.toDataURL(href, { width: 320, margin: 1 }));
      setScanQr(await QRCode.toDataURL(buildScanLink(window.location.origin, href), { width: 320, margin: 1 }));
      setStatus('waiting for payment');
    } catch (e) {
      setError(e instanceof ValidationError ? e.reason : 'could not create the request');
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

  // One lookup-and-verify round: signatures for the reference (errors skipped), the newest
  // unrejected ones verified, at most 5 per round. A lookup that throws changes nothing.
  const pollOnce = async (r: Request): Promise<WatchState> => {
    const reference = r.reference.toBase58();
    let state = watchFor(watch.current, reference);
    let entries;
    try {
      entries = await connection.getSignaturesForAddress(r.reference, { limit: MERCHANT_LOOKUP_LIMIT }, 'confirmed');
    } catch {
      return state;
    }
    for (const signature of selectToVerify(entries, state.rejected)) {
      state = applyOutcome(state, signature, await verifyOnce(signature, r));
      watch.current = storeWatch(watch.current, reference, state);
      if (state.paid) break;
    }
    return state;
  };

  useEffect(() => {
    if (!request || paid || expired) return;
    let cancelled = false;
    (async () => {
      const deadline = Date.now() + REFERENCE_LIMIT_MS;
      while (!cancelled && Date.now() < deadline) {
        const state = await pollOnce(request);
        if (cancelled) return;
        if (state.paid) {
          setPaid(state.paid);
          return;
        }
        if (state.mismatch) setStatus(MISMATCH_TEXT);
        await sleep(REFERENCE_POLL_MS);
      }
      if (!cancelled) {
        setExpired(true);
        setStatus(EXPIRED_TEXT);
      }
    })();
    return () => {
      cancelled = true;
    };
    // pollOnce reads the request and the watch ref; the request is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, request, paid, expired]);

  // After expiry: one more full round; stays expired if nothing passes. A pass counts only if this
  // request is still the one on screen when the round returns.
  const checkAgain = async () => {
    if (!request || checking) return;
    setChecking(true);
    try {
      const state = await pollOnce(request);
      if (state.paid && isCurrent(watch.current, request.reference.toBase58())) setPaid(state.paid);
    } finally {
      setChecking(false);
    }
  };

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
        <button onClick={create}>Create request</button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {request && (
        <section style={{ marginTop: '1rem' }}>
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
              <a href={explorer(paid)} target="_blank" rel="noreferrer">
                {paid}
              </a>
            </p>
          ) : (
            <>
              <p style={{ color: expired ? 'crimson' : undefined }}>{status}</p>
              {expired && (
                <button onClick={checkAgain} disabled={checking}>
                  Check again
                </button>
              )}
            </>
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
