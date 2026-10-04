"use client";

import { useWalletConnection } from "@/app/lib/useWalletConnection";
import { WalletDashboard } from "./WalletDashboard";

export default function WalletPage() {
  const { wallet, notice, connecting, switching, connect, disconnectWallet, switchWallet, switchNetwork } = useWalletConnection();

  if (!wallet.address) {
    return (
      <main className="wallet-page">
        <section className="wallet-intro">
          <span className="eyebrow">Wallet</span>
          <h1 className="display-font">Connect a Wallet</h1>
          <p>Connect your own wallet to see your balance, holdings, and activity.</p>
        </section>
        <div className="wallet-page-content">
          <section className="panel wallet-card wallet-connect-card">
            <div className="wallet-card-heading">
              <div><span className="eyebrow">Connection</span><h2>Connect a wallet</h2></div>
              <span className="wallet-status-dot" aria-hidden="true" />
            </div>
            <p className="wallet-card-copy">Scan with Coinbase Wallet, or create one instantly with a passkey. Prophecy never asks for your seed phrase.</p>
            <button type="button" className="wallet-connect-button" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            {notice && <p className="wallet-notice" role="status">{notice}</p>}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="wd-page">
      <WalletDashboard
        wallet={wallet}
        switching={switching}
        switchWallet={switchWallet}
        switchNetwork={switchNetwork}
        disconnectWallet={disconnectWallet}
      />
    </main>
  );
}
