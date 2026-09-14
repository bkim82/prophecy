"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import {
  chainName,
  formatEth,
  getWalletProvider,
  shortenAddress,
  type EthereumProvider,
} from "@/app/lib/wallet";

type WalletState = {
  address: string | null;
  chain: string | null;
  balance: string | null;
};

const EMPTY_WALLET: WalletState = { address: null, chain: null, balance: null };

export default function WalletPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [stake, setStake] = useState("25");

  const refreshWallet = async (provider: EthereumProvider, address?: string) => {
    const accounts = address ? [address] : (await provider.request({ method: "eth_accounts" }) as string[]);
    if (!accounts[0]) {
      setWallet(EMPTY_WALLET);
      return;
    }
    const [chainId, balance] = await Promise.all([
      provider.request({ method: "eth_chainId" }) as Promise<string>,
      provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as Promise<string>,
    ]);
    setWallet({ address: accounts[0], chain: chainName(chainId), balance: formatEth(balance) });
  };

  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    void refreshWallet(provider);
    const onAccountsChanged = (...args: unknown[]) => void refreshWallet(provider, (args[0] as string[])[0]);
    const onChainChanged = () => void refreshWallet(provider);
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = async () => {
    const provider = getWalletProvider();
    if (!provider) {
      setNotice("No injected wallet found. Install MetaMask or another EVM wallet to connect.");
      return;
    }
    setConnecting(true);
    setNotice(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      await refreshWallet(provider, accounts[0]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wallet connection was cancelled.");
    } finally {
      setConnecting(false);
    }
  };

  const openPulse = (side: "long" | "short") => {
    router.push(`/duel/btc/pulse?side=${side}`);
  };

  return (
    <main className="wallet-shell">
      <div className="wallet-main">
        <section className="wallet-intro">
          <span className="eyebrow">Wallet desk</span>
          <h1 className="display-font">Trade beside the feed</h1>
          <p>Connect your own wallet once, then keep a fast BTC directional ticket in reach while you read the market.</p>
        </section>
        <FeedSwitcher posts={GLOBAL_POSTS} />
      </div>

      <aside className="wallet-sidebar">
        <section className="panel wallet-card wallet-connect-card">
          <div className="wallet-card-heading">
            <div>
              <span className="eyebrow">Connection</span>
              <h2>{wallet.address ? "Wallet connected" : "Connect a wallet"}</h2>
            </div>
            <span className={`wallet-status-dot${wallet.address ? " is-connected" : ""}`} aria-hidden="true" />
          </div>
          {wallet.address ? (
            <>
              <div className="wallet-address">{shortenAddress(wallet.address)}</div>
              <div className="wallet-meta"><span>{wallet.chain}</span><span>{wallet.balance ?? "—"} ETH</span></div>
              <button type="button" className="wallet-secondary-button" onClick={connect}>Switch wallet</button>
            </>
          ) : (
            <>
              <p className="wallet-card-copy">Use your browser wallet. Prophecy never asks for your seed phrase.</p>
              <button type="button" className="wallet-connect-button" onClick={connect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            </>
          )}
        </section>

        <section className="panel wallet-card wallet-ticket">
          <div className="wallet-ticket-heading"><div><span className="eyebrow">Quick ticket</span><h2>BTC / USD</h2></div><span className="wallet-live-dot">Live</span></div>
          <div className="wallet-ticket-row"><span>Stake</span><label className="wallet-input-wrap"><input value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" aria-label="Stake" /><span>embers</span></label></div>
          <div className="wallet-ticket-row"><span>Leverage</span><span className="wallet-ticket-value">100×</span></div>
          <div className="wallet-actions">
            <button type="button" className="wallet-side-button is-long" disabled={!wallet.address} onClick={() => openPulse("long")}><span>Long</span><span>↗</span></button>
            <button type="button" className="wallet-side-button is-short" disabled={!wallet.address} onClick={() => openPulse("short")}><span>Short</span><span>↘</span></button>
          </div>
          <p className="wallet-ticket-note">{wallet.address ? "Your wallet is connected. Pulse uses the existing Prophecy balance for this round." : "Connect your wallet to unlock the ticket."}</p>
          {notice && <p className="wallet-notice" role="status">{notice} {wallet.address && notice.includes("ready") && <Link href="/duel/btc/pulse">Open Pulse →</Link>}</p>}
        </section>

        <FeedSidebar />
      </aside>
    </main>
  );
}
