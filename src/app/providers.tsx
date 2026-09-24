'use client';

// Wallet-adapter context. The connection endpoint is this origin's /api/rpc, so the browser never
// holds an RPC URL; wallets={[]} leaves discovery to the Wallet Standard (Phantom registers itself).

import { useEffect, useState, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function Providers({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/rpc`);
  }, []);
  if (!endpoint) return null;
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
