"use client";

import { WalletDesk } from "@/app/WalletDesk";

export default function WalletPage() {

  return (
    <main className="wallet-page">
      <section className="wallet-intro">
        <span className="eyebrow">Wallet</span>
        <h1 className="display-font">Connect a Wallet</h1>
        <p>Connect your own wallet to unlock the quick ticket and view your current holdings.</p>
      </section>
      <div className="wallet-page-content">
        <WalletDesk showHoldings showTicket={false} />
      </div>
    </main>
  );
}
