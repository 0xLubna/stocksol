import { REPO_URL } from '../lib/site';

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>StockPay</h1>
      <p style={{ fontSize: '1.25rem' }}>Pay from tokenized stocks, get paid in USDC.</p>
      <p>
        StockPay sells just enough of your holding to pay a Solana Pay request, in one transaction when the route fits. Payments are
        switched off on this public demo; the README links the real mainnet payments we made.
      </p>
      <p>
        <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          How it works
        </a>
      </p>
    </main>
  );
}
