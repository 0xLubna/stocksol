import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>StockPay</h1>
      <p>
        Pay any Solana Pay merchant or wallet from tokenized-stock holdings: the sale and the exact USDC payment go in one
        transaction when it fits, otherwise in two, the sale first.
      </p>
      <ul>
        <li>
          <Link href="/pay">Pay</Link>: connect a wallet, paste a Solana Pay URL or an address, sell just enough stock and pay.
        </li>
        <li>
          <Link href="/merchant">Merchant</Link>: create a payment request with a QR code and watch it get paid.
        </li>
      </ul>
    </main>
  );
}
