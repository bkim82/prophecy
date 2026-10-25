"use client";

import { useWalletIdentity } from "@/app/lib/useWalletConnection";
import { MOCK_ACTIVITY, MOCK_HOLDINGS, MOCK_WALLET, WALLET_MOCK_ENABLED } from "./mockWallet";
import { WalletDashboard, type WalletMock } from "./WalletDashboard";

const MOCK: WalletMock = { holdings: MOCK_HOLDINGS, activity: MOCK_ACTIVITY };

export default function WalletPage() {
  const { wallet, notice, isLoaded, signIn, signOut } = useWalletIdentity();

  // `next dev` can't complete sign-in, so a signed-out local session gets the mock wallet.
  if (!wallet.address && WALLET_MOCK_ENABLED) {
    return (
      <main className="wd-page">
        <p className="wallet-notice" role="status">Mock wallet: local dev only, sign-in skipped. Send and swap won&apos;t go through.</p>
        <WalletDashboard wallet={MOCK_WALLET} signOut={async () => {}} mock={MOCK} />
      </main>
    );
  }

  if (!wallet.address) {
    return (
      <main className="wallet-page">
        <section className="wallet-intro">
          <span className="eyebrow">Wallet</span>
          <h1 className="display-font">Sign in</h1>
          <p>Sign in to use your Prophecy smart account on Base.</p>
        </section>
        <div className="wallet-page-content">
          <section className="panel wallet-card wallet-connect-card">
            <div className="wallet-card-heading">
              <div><span className="eyebrow">Account</span><h2>Your embedded wallet</h2></div>
              <span className="wallet-status-dot" aria-hidden="true" />
            </div>
            <p className="wallet-card-copy">Your canonical Base smart account is created with your Prophecy account. Prophecy never receives a seed phrase or owner key.</p>
            <button type="button" className="wallet-connect-button" onClick={signIn} disabled={!isLoaded}>
              {isLoaded ? "Sign in" : "Loading…"}
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
        signOut={signOut}
      />
    </main>
  );
}
