'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Keypair, PublicKey, SendTransactionError, VersionedTransaction, type AccountInfo, type AddressLookupTableAccount } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import Providers from '../providers';
import { payableHoldings, USDC, type RegistryEntry } from '../../registry';
import { isSigner, matchAmount } from '../../lib/amount-match';
import { encodeBase58 } from '../../lib/base58';
import { checkPayment, type CheckResult } from '../../lib/check-payment';
import { currentMultiplier, formatScaled, type ScaledUiAmountConfig } from '../../lib/display';
import {
  candidatesOf,
  evaluateHistory,
  historyRequest,
  HISTORY_MAX_READS,
  HISTORY_PAGE_LIMIT,
  HISTORY_UNAVAILABLE,
  needsHistoryCheck,
  pageReachesEdge,
  type HistoryCheck,
  type HistoryEntry,
  type HistoryRead,
} from '../../lib/paid-history';
import { readPayUrl } from '../../lib/pay-url';
import { buildReceipt, type Receipt, type ReceiptTransaction } from '../../lib/receipt';
import { evaluateReference, REFERENCE_LOOKUP_LIMIT, successfulSignatures, type ReferenceCheck, type ReferenceEntry, type VerifyOutcome } from '../../lib/reference-check';
import { adjustedMaxLoss, checkReturned } from '../../lib/returned-check';
import { base64ToBytes, checkSimulation, isPayerTokenAccount, type CheckedAccount } from '../../lib/simulation-check';
import { PAY_ENABLED, REPO_URL } from '../../lib/site';
import { formatSol, transactionCost, transactionFee } from '../../lib/sol-budget';
import { parseAmountUsdc, parseWalletAddress, ValidationError } from '../../lib/validate';

// Polling as built: status every 2 s; the first transaction gets 90 s, the split path's payment
// 60 s; then an extra window of 5 s polls for 120 s with a live countdown; nothing is ever resent.
const STATUS_POLL_MS = 2000;
const FIRST_LIMIT_MS = 90_000;
const SPLIT_PAYMENT_LIMIT_MS = 60_000;
const EXTRA_POLL_MS = 5000;
const EXTRA_WINDOW_MS = 120_000;
const VERIFY_POLL_MS = 3000;
const VERIFY_LIMIT_MS = 60_000;
const QUOTE_TTL_MS = 30_000;
const ACCOUNTS_PER_READ = 100;

// Every text the page can show, other than validation reasons, the checks' own reasons, /api/pay's
// 400 body and the reason in /api/verify's 200, is one of these.
const TEXT = {
  busy: 'busy, try again',
  quoteFailed: 'could not get a quote, try again',
  networkBusy: 'network busy, try again',
  notSigned: 'Not signed; nothing was sent.',
  notSent: 'Not sent; nothing was paid.',
  walletChanged: 'wallet changed the transaction',
  paymentNotSentAfterSale: 'The sale went through and nothing was paid. The USDC from the sale is in your wallet.',
  failedOnChain: 'Failed on chain; nothing was paid.',
  usdcInWallet: 'The USDC from the sale is in your wallet.',
  paymentConfirmed: 'Payment confirmed',
  verified: 'Verified',
  notVerified: 'Not verified',
  verifyUnavailable: 'Verification unavailable right now. The payment is confirmed; do not pay again.',
  quoteExpired: 'Quote expired. Get a new quote.',
  stuckPayment: 'The payment is not confirmed yet. Do not pay again until the explorer shows this signature as failed, or still cannot find it a few minutes from now.',
  stuckSale: 'The sale is not confirmed yet and nothing was paid. Do not start a new payment until the explorer shows this signature as failed, or still cannot find it a few minutes from now.',
} as const;

type Target = { recipient: PublicKey; amountUsdc: bigint; amountText: string; reference: PublicKey; label: string | null; fromLink: boolean };

type Quote = {
  target: Target;
  holding: RegistryEntry;
  transactions: VersionedTransaction[];
  lookupTables: AddressLookupTableAccount[];
  sizes: { withTables: number; withoutTables: number };
  single: boolean;
  route: string[];
  inAmount: bigint;
  outAmount: bigint;
  otherAmountThreshold: bigint;
  lamportsRequired: bigint;
  reserveLamports: bigint;
  /** The newest signature the quote-time history check saw; the pre-sign run reads only newer ones. */
  historyUntil: string | null;
  /** The payment check, then the simulation check; the first refusal wins. */
  check: CheckResult;
};

// idle: no quote. quoted: pay allowed once. inflight: something was sent, both buttons locked.
// stuck: a signature is unconfirmed after its windows, only "Check status again". ended: the flow
// finished one way or another; a new quote may be requested, the old pay button stays locked.
type Phase = 'idle' | 'quoted' | 'inflight' | 'stuck' | 'ended';
type Stage = 'swap' | 'payment';
type Pending = { stage: Stage; signature: string; split: boolean; signedPayment: VersionedTransaction | null; saleSignature: string | null };
type Outcome = { text: string; signature: string | null; extra?: string };
type Status = 'confirmed' | 'failed' | 'pending';
type SimulationInput = {
  transactions: VersionedTransaction[];
  lookupTables: AddressLookupTableAccount[];
  holding: RegistryEntry;
  single: boolean;
  inAmount: bigint;
  otherAmountThreshold: bigint;
  amountUsdc: bigint;
  maxLamportsLoss: bigint;
  paymentFee: bigint;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}`;
const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function Signature({ signature }: { signature: string }) {
  return (
    <a href={explorer(signature)} target="_blank" rel="noreferrer">
      {signature}
    </a>
  );
}

function PayPage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const holdings = payableHoldings();
  const [holding, setHolding] = useState<RegistryEntry>(holdings[0]);
  const [urlText, setUrlText] = useState('');
  const [addressText, setAddressText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusedSignature, setRefusedSignature] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [live, setLive] = useState<string | null>(null);
  const [stuck, setStuck] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmedPayment, setConfirmedPayment] = useState<string | null>(null);
  const [verification, setVerification] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Synchronous in-flight guard: a second tap before re-render does nothing.
  const inFlight = useRef(false);
  const linkRead = useRef(false);

  const note = useCallback((line: string) => setLog((l) => [...l, line]), []);

  // A scan-to-pay link arrives as ?link=; read once on load, into the empty link field only.
  // Nothing is quoted or signed from it; it goes through readPayUrl like a pasted link.
  useEffect(() => {
    if (linkRead.current) return;
    linkRead.current = true;
    const link = new URLSearchParams(window.location.search).get('link');
    if (link) setUrlText((current) => (current === '' ? link : current));
  }, []);

  // Scaled-UI multiplier of the holding's mint, for display only; code keeps raw units.
  useEffect(() => {
    let cancelled = false;
    connection
      .getParsedAccountInfo(new PublicKey(holding.mint))
      .then((info) => {
        const data = info.value?.data;
        if (!data || !('parsed' in data)) return;
        const extensions = (data.parsed.info?.extensions ?? []) as { extension: string; state: unknown }[];
        const scaled = extensions.find((e) => e.extension === 'scaledUiAmountConfig');
        if (!cancelled && scaled) setMultiplier(currentMultiplier(scaled.state as ScaledUiAmountConfig, Math.floor(Date.now() / 1000)));
      })
      .catch(() => {
        if (!cancelled) setMultiplier(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, holding.mint]);

  // An unsent quote is dropped when its inputs, the holding or the wallet change.
  const invalidateQuote = useCallback(() => {
    setPhase((p) => {
      if (p !== 'quoted') return p;
      setQuote(null);
      setError(null);
      setRefusedSignature(null);
      return 'idle';
    });
  }, []);
  const walletKey = publicKey?.toBase58() ?? null;
  useEffect(() => {
    invalidateQuote();
  }, [walletKey, invalidateQuote]);

  // A quote expires 30 s after it is shown.
  useEffect(() => {
    if (phase !== 'quoted' || !quote) return;
    setQuoteExpired(false);
    const id = setTimeout(() => setQuoteExpired(true), QUOTE_TTL_MS);
    return () => clearTimeout(id);
  }, [phase, quote]);

  // While something is in flight or stuck, leaving the page asks first.
  useEffect(() => {
    if (phase !== 'inflight' && phase !== 'stuck') return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [phase]);

  const readTarget = (): Target => {
    if (urlText.trim()) {
      const read = readPayUrl(urlText);
      if (!read.ok) throw new ValidationError(read.reason);
      return {
        recipient: parseWalletAddress(read.request.recipient.toBase58(), 'recipient'),
        amountUsdc: parseAmountUsdc(read.request.amountText),
        amountText: read.request.amountText,
        reference: read.request.reference ?? Keypair.generate().publicKey,
        label: read.request.label,
        fromLink: true,
      };
    }
    return {
      recipient: parseWalletAddress(addressText.trim(), 'recipient'),
      amountUsdc: parseAmountUsdc(amountText.trim()),
      amountText: amountText.trim(),
      reference: Keypair.generate().publicKey,
      label: null,
      fromLink: false,
    };
  };

  // One verifier call, as an outcome for the reference check. Never throws.
  const verifyOnce = async (signature: string, t: Target): Promise<VerifyOutcome> => {
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signature, recipient: t.recipient.toBase58(), amountUsdc: t.amountText, reference: t.reference.toBase58() }),
      });
      if (res.status !== 200) return { kind: 'response', status: res.status, ok: false };
      const body = await res.json();
      return { kind: 'response', status: 200, ok: body.ok === true };
    } catch {
      return { kind: 'threw' };
    }
  };

  // Has this reference been paid already? Signatures through /api/rpc, each successful one verified.
  const referenceCheck = async (t: Target): Promise<ReferenceCheck> => {
    let entries: ReferenceEntry[] | null;
    try {
      entries = await connection.getSignaturesForAddress(t.reference, { limit: REFERENCE_LOOKUP_LIMIT }, 'confirmed');
    } catch {
      entries = null;
    }
    const outcomes = new Map<string, VerifyOutcome>();
    if (entries) for (const signature of successfulSignatures(entries)) outcomes.set(signature, await verifyOnce(signature, t));
    return evaluateReference(entries, outcomes);
  };

  // Has this wallet already paid this link without the reference? The payer's USDC account
  // history of the last 24 hours, paged newest first, every candidate read; never skipped.
  const historyCheck = async (t: Target, payerKey: PublicKey, until: string | null): Promise<{ check: HistoryCheck; newest: string | null }> => {
    const payerAta = getAssociatedTokenAddressSync(new PublicKey(USDC.mint), payerKey, false, TOKEN_PROGRAM_ID);
    const recipientAta = getAssociatedTokenAddressSync(new PublicKey(USDC.mint), t.recipient, false, TOKEN_PROGRAM_ID).toBase58();
    const now = Math.floor(Date.now() / 1000);
    const candidates: string[] = [];
    let newest: string | null = null;
    let before: string | null = null;
    let reachedEdge = false;
    try {
      for (;;) {
        const request = historyRequest(until, before);
        const entries: HistoryEntry[] = await connection.getSignaturesForAddress(
          payerAta,
          { limit: HISTORY_PAGE_LIMIT, until: request.until ?? undefined, before: request.before ?? undefined },
          'confirmed',
        );
        if (newest === null && entries.length > 0) newest = entries[0].signature;
        candidates.push(...candidatesOf(entries, now));
        if (pageReachesEdge(entries, now)) {
          reachedEdge = true;
          break;
        }
        if (candidates.length > HISTORY_MAX_READS) break;
        before = entries[entries.length - 1].signature;
      }
    } catch {
      return { check: { status: 'incomplete' }, newest };
    }
    const reads = new Map<string, HistoryRead>();
    for (const signature of candidates.slice(0, HISTORY_MAX_READS)) {
      try {
        const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx) reads.set(signature, { kind: 'missing' });
        else {
          const matched = isSigner(tx, payerKey.toBase58()) && matchAmount(tx, { recipient: t.recipient.toBase58(), recipientAta, usdcMint: USDC.mint, amountUsdc: t.amountUsdc }).ok;
          reads.set(signature, { kind: matched ? 'matched' : 'unmatched' });
        }
      } catch {
        reads.set(signature, { kind: 'threw' });
      }
    }
    return { check: evaluateHistory(candidates, reads, reachedEdge && candidates.length <= HISTORY_MAX_READS), newest };
  };

  // Shows a reference refusal or an incomplete check; returns whether the flow may go on.
  const applyReferenceCheck = (r: ReferenceCheck): boolean => {
    if (r.status === 'clear') return true;
    if (r.status === 'refused') {
      setError(r.reason);
      setRefusedSignature(r.signature);
    } else {
      setError(TEXT.networkBusy);
    }
    return false;
  };

  const applyHistoryCheck = (r: HistoryCheck): boolean => {
    if (r.status === 'clear') return true;
    if (r.status === 'refused') {
      setError(r.reason);
      setRefusedSignature(r.signature);
    } else {
      setError(HISTORY_UNAVAILABLE);
    }
    return false;
  };

  // The simulated-balance check on the swap-carrying transaction; the reads go through /api/rpc.
  // Returns null when a read or the simulation could not be done.
  const simulationCheck = async (s: SimulationInput, payerKey: PublicKey): Promise<CheckResult | null> => {
    try {
      const tx = s.transactions[0];
      const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: s.lookupTables });
      const payerUsdc = getAssociatedTokenAddressSync(new PublicKey(USDC.mint), payerKey, false, TOKEN_PROGRAM_ID);
      const seen = new Set<string>([payerKey.toBase58()]);
      const toRead: PublicKey[] = [payerKey];
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys.get(i);
        if (k && !seen.has(k.toBase58())) {
          seen.add(k.toBase58());
          toRead.push(k);
        }
      }
      if (!seen.has(payerUsdc.toBase58())) toRead.push(payerUsdc);
      const infos: (AccountInfo<Buffer> | null)[] = [];
      for (let i = 0; i < toRead.length; i += ACCOUNTS_PER_READ) {
        infos.push(...(await connection.getMultipleAccountsInfo(toRead.slice(i, i + ACCOUNTS_PER_READ), 'confirmed')));
      }
      const payerPre = BigInt(infos[0]?.lamports ?? 0);
      const payer = payerKey.toBase58();
      const checked: { address: PublicKey; pre: Uint8Array | null }[] = [];
      toRead.forEach((address, i) => {
        if (i === 0) return;
        const info = infos[i];
        if (info && isPayerTokenAccount(info.owner.toBase58(), new Uint8Array(info.data), payer)) {
          checked.push({ address, pre: new Uint8Array(info.data) });
        } else if (address.equals(payerUsdc)) {
          checked.push({ address, pre: null });
        }
      });
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: 'base64', addresses: [payer, ...checked.map((c) => c.address.toBase58())] },
      });
      const returned = sim.value.accounts ?? [];
      const accounts: CheckedAccount[] = checked.map((c, i) => {
        const r = returned[i + 1];
        return { address: c.address.toBase58(), pre: c.pre, post: r ? base64ToBytes(r.data[0]) : null };
      });
      return checkSimulation({
        err: sim.value.err,
        payerPreLamports: payerPre,
        payerPostLamports: returned[0] ? BigInt(returned[0].lamports) : null,
        accounts,
        payer,
        holdingMint: s.holding.mint,
        usdcMint: USDC.mint,
        payerUsdcAccount: payerUsdc.toBase58(),
        inAmount: s.inAmount,
        otherAmountThreshold: s.otherAmountThreshold,
        amountUsdc: s.amountUsdc,
        single: s.single,
        maxLamportsLoss: s.maxLamportsLoss,
        paymentFee: s.paymentFee,
      });
    } catch {
      return null;
    }
  };

  // Lookup tables named by transactions, from chain through /api/rpc; `have` is reused.
  const resolveTables = async (transactions: VersionedTransaction[], have: AddressLookupTableAccount[]): Promise<AddressLookupTableAccount[]> => {
    const known = new Map(have.map((t) => [t.key.toBase58(), t]));
    for (const tx of transactions) {
      for (const lookup of tx.message.addressTableLookups) {
        const key = lookup.accountKey.toBase58();
        if (known.has(key)) continue;
        const table = await connection.getAddressLookupTable(lookup.accountKey);
        if (table.value) known.set(key, table.value);
      }
    }
    return [...known.values()];
  };

  const getQuote = async () => {
    if (!publicKey || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setRefusedSignature(null);
    setQuote(null);
    setOutcome(null);
    setConfirmedPayment(null);
    setVerification(null);
    setReceipt(null);
    setStuck(null);
    setLive(null);
    setLog([]);
    setPhase('idle');
    setBusy(true);
    try {
      let t: Target;
      try {
        t = readTarget();
        if (t.recipient.equals(publicKey)) throw new ValidationError('recipient must differ from payer');
      } catch (e) {
        setError(e instanceof ValidationError ? e.reason : TEXT.quoteFailed);
        return;
      }
      if (!applyReferenceCheck(await referenceCheck(t))) return;
      let historyUntil: string | null = null;
      if (needsHistoryCheck(t)) {
        const history = await historyCheck(t, publicKey, null);
        if (!applyHistoryCheck(history.check)) return;
        historyUntil = history.newest;
      }

      let res: Response;
      try {
        res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            payer: publicKey.toBase58(),
            recipient: t.recipient.toBase58(),
            amountUsdc: t.amountText,
            reference: t.reference.toBase58(),
            inMint: holding.mint,
          }),
        });
      } catch {
        setError(TEXT.quoteFailed);
        return;
      }
      // 503 is the route's own "busy"; 429 comes from rate limiting in front of it.
      if (res.status === 503 || res.status === 429) {
        setError(TEXT.busy);
        return;
      }
      if (res.status === 400) {
        setError(await res.text().catch(() => TEXT.quoteFailed));
        return;
      }
      if (!res.ok) {
        setError(TEXT.quoteFailed);
        return;
      }

      let built: Omit<Quote, 'check'>;
      let paymentCheck: CheckResult;
      try {
        const body = await res.json();
        const transactions = (body.transactions as string[]).map((b64) => VersionedTransaction.deserialize(base64ToBytes(b64)));
        // Lookup tables come from chain through /api/rpc, never from the /api/pay response.
        const lookupTables = await resolveTables(transactions, []);
        paymentCheck = checkPayment({ transactions, lookupTables, payer: publicKey, recipient: t.recipient, amountUsdc: t.amountUsdc, reference: t.reference });
        built = {
          target: t,
          holding,
          transactions,
          lookupTables,
          sizes: body.sizes,
          single: body.single,
          route: body.route,
          inAmount: BigInt(body.inAmount),
          outAmount: BigInt(body.outAmount),
          otherAmountThreshold: BigInt(body.otherAmountThreshold),
          lamportsRequired: BigInt(body.lamportsRequired),
          reserveLamports: BigInt(body.lamportsBreakdown.reserve),
          historyUntil,
        };
      } catch {
        setError(TEXT.networkBusy);
        return;
      }
      let check = paymentCheck;
      if (check.ok) {
        const simulated = await simulationCheck(
          {
            transactions: built.transactions,
            lookupTables: built.lookupTables,
            holding: built.holding,
            single: built.single,
            inAmount: built.inAmount,
            otherAmountThreshold: built.otherAmountThreshold,
            amountUsdc: t.amountUsdc,
            maxLamportsLoss: built.lamportsRequired - built.reserveLamports,
            paymentFee: built.single ? BigInt(0) : transactionFee(transactionCost(built.transactions[1])),
          },
          publicKey,
        );
        if (simulated === null) {
          setError(TEXT.networkBusy);
          return;
        }
        check = simulated;
      }
      if (!check.ok) note(`refused: ${check.reason}`);
      setQuote({ ...built, check });
      setPhase('quoted');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  // One status read. A read that throws counts as not confirmed yet; only err ends tracking.
  const readStatus = async (signature: string): Promise<Status> => {
    try {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) return 'failed';
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return 'confirmed';
      return 'pending';
    } catch {
      return 'pending';
    }
  };

  const pollUntil = async (signature: string, limitMs: number): Promise<Status> => {
    const deadline = Date.now() + limitMs;
    while (Date.now() < deadline) {
      const status = await readStatus(signature);
      if (status !== 'pending') return status;
      await sleep(STATUS_POLL_MS);
    }
    return 'pending';
  };

  // The extra window: a 5 s poll for 120 s with a live countdown; sends nothing.
  const extraWindow = async (signature: string): Promise<Status> => {
    const deadline = Date.now() + EXTRA_WINDOW_MS;
    let nextPoll = Date.now();
    try {
      while (Date.now() < deadline) {
        if (Date.now() >= nextPoll) {
          const status = await readStatus(signature);
          if (status !== 'pending') return status;
          nextPoll = Date.now() + EXTRA_POLL_MS;
        }
        setLive(`Confirming... checking again in ${Math.max(1, Math.ceil((nextPoll - Date.now()) / 1000))} s, giving up in ${mmss(deadline - Date.now())}`);
        await sleep(1000);
      }
      return 'pending';
    } finally {
      setLive(null);
    }
  };

  // Verification: any status other than 200, and a fetch that throws, wait and retry within the
  // limit. Returns whether the verifier passed.
  const verify = async (signature: string, t: Target): Promise<boolean> => {
    const deadline = Date.now() + VERIFY_LIMIT_MS;
    while (Date.now() < deadline) {
      const outcome = await verifyOnce(signature, t);
      if (outcome.kind === 'response' && outcome.status === 200) {
        if (outcome.ok) {
          setVerification(TEXT.verified);
          return true;
        }
        let reason = 'unknown';
        try {
          const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ signature, recipient: t.recipient.toBase58(), amountUsdc: t.amountText, reference: t.reference.toBase58() }),
          });
          if (res.status === 200) {
            const body = await res.json();
            if (typeof body.reason === 'string') reason = body.reason;
          }
        } catch {
          // the reason stays unknown
        }
        setVerification(`${TEXT.notVerified}: ${reason}`);
        return false;
      }
      await sleep(VERIFY_POLL_MS);
    }
    setVerification(TEXT.verifyUnavailable);
    return false;
  };

  // The receipt from the confirmed transactions; a failed read shows nothing extra.
  const loadReceipt = async (signatures: string[], q: Quote) => {
    try {
      const transactions: ReceiptTransaction[] = [];
      for (const signature of signatures) {
        const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (!tx || !tx.meta) return;
        transactions.push({ meta: { fee: tx.meta.fee, preTokenBalances: tx.meta.preTokenBalances, postTokenBalances: tx.meta.postTokenBalances } });
      }
      setReceipt(
        buildReceipt({
          transactions,
          single: q.single,
          payer: publicKey?.toBase58() ?? '',
          recipient: q.target.recipient.toBase58(),
          holdingMint: q.holding.mint,
          usdcMint: USDC.mint,
          amountUsdc: q.target.amountUsdc,
          holdingDecimals: q.holding.decimals,
          multiplier: multiplier ?? 1,
        }),
      );
    } catch {
      // nothing extra
    }
  };

  const end = (o: Outcome | null) => {
    if (o) setOutcome(o);
    setPhase('ended');
  };

  const failedOnChain = (p: Pending) => {
    note(`${p.stage === 'swap' ? 'sale' : 'payment'} failed on chain: ${p.signature}`);
    end({ text: TEXT.failedOnChain, signature: p.signature, extra: p.stage === 'payment' && p.split ? TEXT.usdcInWallet : undefined });
  };

  // Sends once. Returns the signature to track, or null when the RPC refused it and nothing was sent.
  const sendOnce = async (tx: VersionedTransaction): Promise<string | null> => {
    const signature = encodeBase58(tx.signatures[0]);
    try {
      await connection.sendRawTransaction(tx.serialize());
    } catch (e) {
      if (e instanceof SendTransactionError) return null;
      // Any other throw: the transaction may have gone out; track it as if the send had succeeded.
    }
    return signature;
  };

  // What happens once a signature confirms: the split path's swap leads to sending the payment
  // once; a confirmed payment leads to verification and the receipt.
  const onConfirmed = async (p: Pending, q: Quote) => {
    note(`${p.stage === 'swap' ? 'sale' : 'payment'} confirmed: ${p.signature}`);
    if (p.stage === 'swap' && p.signedPayment) {
      const signature = await sendOnce(p.signedPayment);
      if (signature === null) {
        end({ text: TEXT.paymentNotSentAfterSale, signature: p.signature });
        return;
      }
      note(`payment sent: ${signature}`);
      await track({ stage: 'payment', signature, split: true, signedPayment: null, saleSignature: p.signature }, SPLIT_PAYMENT_LIMIT_MS, q);
      return;
    }
    setConfirmedPayment(p.signature);
    setUrlText('');
    setAddressText('');
    setAmountText('');
    const passed = await verify(p.signature, q.target);
    if (passed) await loadReceipt(p.saleSignature ? [p.saleSignature, p.signature] : [p.signature], q);
    end(null);
  };

  const track = async (p: Pending, limitMs: number, q: Quote) => {
    let status = await pollUntil(p.signature, limitMs);
    if (status === 'pending') status = await extraWindow(p.signature);
    if (status === 'confirmed') {
      await onConfirmed(p, q);
      return;
    }
    if (status === 'failed') {
      failedOnChain(p);
      return;
    }
    setStuck(p);
    setPhase('stuck');
  };

  const pay = async () => {
    if (!publicKey || !quote || !quote.check.ok || phase !== 'quoted' || quoteExpired || inFlight.current || !signTransaction || !signAllTransactions) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setRefusedSignature(null);
    try {
      const q = quote;
      // The reference and the wallet's history are checked again right before the wallet is asked.
      const ref = await referenceCheck(q.target);
      if (ref.status === 'refused') {
        applyReferenceCheck(ref);
        setQuote(null);
        setPhase('idle');
        return;
      }
      if (ref.status === 'incomplete') {
        setError(TEXT.networkBusy);
        return;
      }
      if (needsHistoryCheck(q.target)) {
        const history = await historyCheck(q.target, publicKey, q.historyUntil);
        if (history.check.status === 'refused') {
          applyHistoryCheck(history.check);
          setQuote(null);
          setPhase('idle');
          return;
        }
        if (history.check.status === 'incomplete') {
          setError(HISTORY_UNAVAILABLE);
          return;
        }
      }
      let signed: VersionedTransaction[];
      try {
        signed = q.transactions.length === 1 ? [await signTransaction(q.transactions[0])] : await signAllTransactions(q.transactions);
      } catch {
        setError(TEXT.notSigned);
        return;
      }
      // From here on the pay button never re-enables for this quote.
      setPhase('inflight');
      // What the wallet returned is checked again before anything is sent: any lookup table it
      // names is resolved from chain, the payment check runs with trailing Lighthouse allowed, the
      // returned instructions must match the checked ones, and the swap is simulated again.
      let tables: AddressLookupTableAccount[];
      try {
        tables = await resolveTables(signed, q.lookupTables);
      } catch {
        end({ text: TEXT.notSent, signature: null, extra: TEXT.networkBusy });
        return;
      }
      signed.forEach((s, i) => {
        if (!sameBytes(s.message.serialize(), q.transactions[i].message.serialize())) note(TEXT.walletChanged);
      });
      const returned = checkReturned({ checked: q.transactions, returned: signed, lookupTables: tables, payer: publicKey, recipient: q.target.recipient, amountUsdc: q.target.amountUsdc, reference: q.target.reference });
      returned.log.forEach(note);
      if (!returned.ok) {
        end({ text: TEXT.notSent, signature: null, extra: returned.reason });
        return;
      }
      const split = !q.single;
      const resimulated = await simulationCheck(
        {
          transactions: signed,
          lookupTables: tables,
          holding: q.holding,
          single: q.single,
          inAmount: q.inAmount,
          otherAmountThreshold: q.otherAmountThreshold,
          amountUsdc: q.target.amountUsdc,
          maxLamportsLoss: adjustedMaxLoss(q.lamportsRequired - q.reserveLamports, returned.fees[0].checked, returned.fees[0].returned),
          paymentFee: split ? returned.fees[1].returned : BigInt(0),
        },
        publicKey,
      );
      if (resimulated === null) {
        end({ text: TEXT.notSent, signature: null, extra: TEXT.networkBusy });
        return;
      }
      if (!resimulated.ok) {
        end({ text: TEXT.notSent, signature: null, extra: resimulated.reason });
        return;
      }
      const signature = await sendOnce(signed[0]);
      if (signature === null) {
        end({ text: TEXT.notSent, signature: null });
        return;
      }
      note(`${split ? 'sale' : 'payment'} sent: ${signature}`);
      await track({ stage: split ? 'swap' : 'payment', signature, split, signedPayment: split ? signed[1] : null, saleSignature: null }, FIRST_LIMIT_MS, q);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  // Re-polls the stuck signature for another window; never signs or sends anything.
  const checkAgain = async () => {
    if (!stuck || !quote || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const status = await extraWindow(stuck.signature);
      if (status === 'pending') return;
      const p = stuck;
      setStuck(null);
      if (status === 'confirmed') {
        setPhase('inflight');
        await onConfirmed(p, quote);
      } else {
        failedOnChain(p);
      }
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const sellText = (raw: bigint, h: RegistryEntry) => (multiplier === null ? `${raw} raw` : `${formatScaled(raw, h.decimals, multiplier)} ${h.symbol}`);
  const usdc = (raw: bigint) => formatScaled(raw, USDC.decimals, 1);
  const canQuote = !!publicKey && !busy && (phase === 'idle' || phase === 'quoted' || phase === 'ended');
  const canPay = !!quote && quote.check.ok && !busy && phase === 'quoted' && !quoteExpired;
  const onInput = (set: (v: string) => void) => (v: string) => {
    set(v);
    invalidateQuote();
  };

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pay</h1>
      <WalletMultiButton />
      <section style={{ marginTop: '1rem' }}>
        <label>
          Solana Pay URL
          <input value={urlText} onChange={(e) => onInput(setUrlText)(e.target.value)} placeholder="solana:..." style={{ width: '100%' }} />
        </label>
        <p>or</p>
        <label>
          Recipient address
          <input value={addressText} onChange={(e) => onInput(setAddressText)(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label>
          Amount (USDC)
          <input value={amountText} onChange={(e) => onInput(setAmountText)(e.target.value)} placeholder="1.50" style={{ width: '100%' }} />
        </label>
        <label>
          Pay with
          <select
            value={holding.mint}
            onChange={(e) => {
              setHolding(holdings.find((h) => h.mint === e.target.value) ?? holdings[0]);
              invalidateQuote();
            }}
          >
            {holdings.map((h) => (
              <option key={h.mint} value={h.mint}>
                {h.symbol}
              </option>
            ))}
          </select>
        </label>
        <div style={{ marginTop: '1rem' }}>
          <button onClick={getQuote} disabled={!canQuote}>
            Get quote
          </button>
        </div>
      </section>
      {error && (
        <p style={{ color: 'crimson' }}>
          {error}
          {refusedSignature && (
            <>
              {' '}
              <Signature signature={refusedSignature} />
            </>
          )}
        </p>
      )}
      {quote && (
        <section style={{ marginTop: '1rem' }}>
          <p>
            To: {short(quote.target.recipient.toBase58())}
            {quote.target.label ? ` (${quote.target.label})` : ''}
          </p>
          <p>Route: {quote.route.join(' > ') || 'none'}</p>
          <p>Sell: {sellText(quote.inAmount, quote.holding)}</p>
          <p>
            Expected USDC out: {usdc(quote.outAmount)} (at least {usdc(quote.otherAmountThreshold)}); pays {quote.target.amountText} USDC
          </p>
          <p>
            Size: {quote.sizes.withTables} bytes with lookup tables ({quote.sizes.withoutTables} without);{' '}
            {quote.single ? 'one transaction: the sale and the payment together' : 'two transactions: the sale, then the payment'}
          </p>
          <p>
            Network fees and account rent about {formatSol(quote.lamportsRequired - quote.reserveLamports)} SOL; your wallet needs at least{' '}
            {formatSol(quote.lamportsRequired)} SOL
          </p>
          {quote.check.ok ? (
            <>
              <button onClick={pay} disabled={!canPay}>
                {quote.single ? 'Sign and pay' : 'Sign both and pay'}
              </button>
              {quoteExpired && phase === 'quoted' && <p style={{ color: 'darkorange' }}>{TEXT.quoteExpired}</p>}
            </>
          ) : (
            <p style={{ color: 'crimson' }}>Refused: {quote.check.reason}</p>
          )}
        </section>
      )}
      {log.length > 0 && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{log.join('\n')}</pre>}
      {live && <p>{live}</p>}
      {stuck && (
        <section>
          <p style={{ color: 'darkorange' }}>
            {stuck.stage === 'payment' ? `${TEXT.stuckPayment}${stuck.split ? ` ${TEXT.usdcInWallet}` : ''}` : TEXT.stuckSale}
          </p>
          <p>
            <Signature signature={stuck.signature} />
          </p>
          <button onClick={checkAgain} disabled={busy}>
            Check status again
          </button>
        </section>
      )}
      {outcome && (
        <section>
          <p style={{ color: 'crimson' }}>
            {outcome.text}
            {outcome.extra ? ` ${outcome.extra}` : ''}
          </p>
          {outcome.signature && (
            <p>
              <Signature signature={outcome.signature} />
            </p>
          )}
        </section>
      )}
      {confirmedPayment && (
        <section>
          <p style={{ color: 'green' }}>{TEXT.paymentConfirmed}</p>
          <p>
            <Signature signature={confirmedPayment} />
          </p>
          {verification && <p style={{ color: verification === TEXT.verified ? 'green' : 'darkorange' }}>{verification}</p>}
          {receipt && quote && (
            <table style={{ fontSize: 14 }}>
              <tbody>
                <tr>
                  <td>Sold</td>
                  <td>{sellText(receipt.sold, quote.holding)}</td>
                </tr>
                <tr>
                  <td>Got</td>
                  <td>{usdc(receipt.got)} USDC</td>
                </tr>
                <tr>
                  <td>Paid</td>
                  <td>{usdc(receipt.paid)} USDC</td>
                </tr>
                <tr>
                  <td>Kept</td>
                  <td>{usdc(receipt.kept)} USDC</td>
                </tr>
                <tr>
                  <td>Fees</td>
                  <td>{formatSol(receipt.fees)} SOL</td>
                </tr>
                <tr>
                  <td>Price</td>
                  <td>{receipt.pricePerUnit === null ? '-' : `${receipt.pricePerUnit} USDC per ${quote.holding.symbol}`}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

// Shown while paying is switched off: no wallet, no quote, nothing read from chain.
function PayDisabled() {
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pay</h1>
      <p>
        Paying from stock is switched off on this public demo. The payment log in the{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          README
        </a>{' '}
        links real mainnet payments we made.
      </p>
    </main>
  );
}

export default function Page() {
  if (!PAY_ENABLED) return <PayDisabled />;
  return (
    <Providers>
      <PayPage />
    </Providers>
  );
}
