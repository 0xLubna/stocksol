import type { CSSProperties } from 'react';
import { REPO_URL } from '../lib/site';

const EXPLORER_TX = 'https://explorer.solana.com/tx/2gz1yidCKLjd4SvecSEavg4bnMFes1ka3J69iyQdH2c42uHug5J1Ti7jyaAUt9tqtKbdS98Et3omSLtsv78VK5xE';

const MONO = 'ui-monospace, Menlo, monospace';
const PAPER = '#f4f1ea';
const INK = '#1a1a1a';
const STAMP = '#5b6b8c';

const page: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: '3rem',
  maxWidth: '64rem',
  margin: '0 auto',
  padding: '2rem 1rem',
  fontFamily: 'system-ui, sans-serif',
};

const receipt: CSSProperties = {
  width: '100%',
  maxWidth: '24rem',
  fontFamily: MONO,
  fontSize: '0.9rem',
  lineHeight: 1.6,
  padding: '1.5rem',
  background: PAPER,
  color: INK,
};

const rule: CSSProperties = { borderTop: `1px dashed ${INK}`, margin: '0.75rem 0' };
const centred: CSSProperties = { textAlign: 'center' };

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function Home() {
  return (
    <main style={page}>
      <div style={{ flex: '1 1 20rem' }}>
        <h1 aria-label="StockPay" style={{ fontSize: 'clamp(3rem, 12vw, 6.5rem)', lineHeight: 1, letterSpacing: '-0.03em', margin: '0 0 1rem' }}>
          Stock<span style={{ color: '#8b93a7' }}>Pay</span>
        </h1>
        <p style={{ fontSize: '1.25rem' }}>Pay from tokenized stocks. Get paid in USDC.</p>
        <p style={{ fontFamily: MONO }}>SPYx · NVDAx · TSLAx (xStocks)</p>
        <p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-block', padding: '0.75rem 1em', border: '1px solid currentColor', textDecoration: 'none', fontWeight: 600 }}
          >
            README
          </a>{' '}
          How it works, and the payment log
        </p>
      </div>

      <section aria-label="Receipt for one mainnet payment" style={receipt}>
        <div style={{ ...centred, fontWeight: 700 }}>Trade confirmation</div>
        <div style={centred}>24 Sep 2026, 17:07 UTC</div>
        <div style={rule} />
        <Row label="Sold" value="0.00262853 SPYx" />
        <Row label="One transaction" value="882 bytes" />
        <div style={rule} />
        <div style={{ ...centred, fontWeight: 700 }}>Receipt</div>
        <Row label="Paid to merchant" value="2.000197 USDC" bold />
        <Row label="Change kept" value="0.018795 USDC" />
        <Row label="Network fee" value="0.000005154 SOL" />
        <div style={rule} />
        <div>Merchant found it by reference</div>
        <div>
          <a href={EXPLORER_TX} target="_blank" rel="noreferrer" style={{ color: INK, textDecoration: 'underline' }}>
            2gz1yi...K5xE on Solana Explorer
          </a>
        </div>
        <div style={{ textAlign: 'right', marginTop: '1rem' }}>
          <span
            style={{
              display: 'inline-block',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              border: `2px solid ${STAMP}`,
              color: STAMP,
              padding: '0.2rem 0.6rem',
              transform: 'rotate(-6deg)',
            }}
          >
            Paid
          </span>
        </div>
      </section>
    </main>
  );
}
