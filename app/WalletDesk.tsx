"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { chainName, formatEth, getWalletProvider, shortenAddress, type EthereumProvider } from "@/app/lib/wallet";

type WalletAsset = { symbol: string; balance: string; name?: string };
type WalletState = { address: string | null; chain: string | null; balance: string | null; assets: WalletAsset[] };
type TicketKind = "directional" | "spot";
type Side = "long" | "short" | "buy" | "sell";

const EMPTY_WALLET: WalletState = { address: null, chain: null, balance: null, assets: [] };
const ASSETS = ["BTC", "ETH", "Other"];

export function WalletDesk({ showHoldings = false, showConnection = true, showTicket = true }: { showHoldings?: boolean; showConnection?: boolean; showTicket?: boolean }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [asset, setAsset] = useState("BTC");
  const [kind, setKind] = useState<TicketKind>("directional");
  const [stake, setStake] = useState("25");
  const [leverage, setLeverage] = useState("100");

  const refreshWallet = async (provider: EthereumProvider, address?: string) => {
    const accounts = address ? [address] : await provider.request({ method: "eth_accounts" }) as string[];
    if (!accounts[0]) { setWallet(EMPTY_WALLET); return; }
    const chainId = await provider.request({ method: "eth_chainId" }) as string;
    const balance = await provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
    const eth = formatEth(balance);
    let assets: WalletAsset[] = [{ symbol: "ETH", name: "Ether", balance: eth }];
    try {
      const discovered = await provider.request({ method: "wallet_getAssets", params: [{ account: accounts[0], chainIds: [chainId] }] }) as { assets?: { symbol?: string; name?: string; balance?: string }[] };
      if (discovered.assets?.length) assets = discovered.assets.filter((item) => item.symbol && item.balance).map((item) => ({ symbol: item.symbol!, name: item.name, balance: item.balance! }));
    } catch { /* Most injected wallets do not expose token discovery. ETH remains available. */ }
    setWallet({ address: accounts[0], chain: chainName(chainId), balance: eth, assets });
    window.dispatchEvent(new Event("wallet-updated"));
  };

  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    void refreshWallet(provider);
    const onAccountsChanged = (...args: unknown[]) => void refreshWallet(provider, (args[0] as string[])[0]);
    const onChainChanged = () => void refreshWallet(provider);
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => { provider.removeListener?.("accountsChanged", onAccountsChanged); provider.removeListener?.("chainChanged", onChainChanged); };
  }, []);

  const connect = async () => {
    const provider = getWalletProvider();
    if (!provider) { setNotice("No injected wallet found. Install MetaMask or another EVM wallet."); return; }
    setConnecting(true); setNotice(null);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      await refreshWallet(provider, accounts[0]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Wallet connection was cancelled."); }
    finally { setConnecting(false); }
  };

  const trade = (side: Side) => {
    if (!wallet.address) return;
    if (kind === "directional" && asset === "BTC") router.push(`/duel/btc/pulse?side=${side}&leverage=${leverage}`);
    else if (kind === "directional") setNotice(`${asset} directional trading is selected; the live Pulse venue currently supports BTC.`);
    else setNotice(`${side === "buy" ? "Buy" : "Sell"} ${asset} is ready for a connected trading venue.`);
  };

  return <>
    {showConnection && <section className="panel wallet-card wallet-connect-card">
      <div className="wallet-card-heading"><div><span className="eyebrow">Connection</span><h2>{wallet.address ? "Wallet connected" : "Connect a wallet"}</h2></div><span className={`wallet-status-dot${wallet.address ? " is-connected" : ""}`} aria-hidden="true" /></div>
      {wallet.address ? <><div className="wallet-address">{shortenAddress(wallet.address)}</div><div className="wallet-meta"><span>{wallet.chain}</span><span>{wallet.balance ?? "—"} ETH</span></div><button type="button" className="wallet-secondary-button" onClick={connect}>Switch wallet</button></> : <><p className="wallet-card-copy">Use your browser wallet. Prophecy never asks for your seed phrase.</p><button type="button" className="wallet-connect-button" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button></>}
    </section>}

    {showHoldings && wallet.address && <section className="panel wallet-card wallet-holdings"><div className="wallet-ticket-heading"><div><span className="eyebrow">Portfolio</span><h2>Current holdings</h2></div><span className="wallet-live-dot">Wallet</span></div><div className="wallet-holding-list">{wallet.assets.map((item) => <div className="wallet-holding-row" key={`${item.symbol}-${item.name}`}><span><strong>{item.symbol}</strong><small>{item.name ?? "Asset"}</small></span><span className="wallet-ticket-value">{item.balance}</span></div>)}</div><p className="wallet-ticket-note">Token discovery depends on your wallet provider; native ETH is always shown.</p></section>}

    {showTicket && <section className="panel wallet-card wallet-ticket">
      <div className="wallet-ticket-heading"><div><span className="eyebrow">Quick ticket</span><h2>{asset} / USD</h2></div></div>
      <div className="wallet-asset-picker" role="tablist" aria-label="Trade asset">{ASSETS.map((item) => <button key={item} type="button" className={asset === item ? "is-selected" : ""} onClick={() => setAsset(item)}>{item}</button>)}</div>
      <div className="wallet-mode-picker" role="tablist" aria-label="Trade type"><button type="button" className={kind === "directional" ? "is-selected" : ""} onClick={() => setKind("directional")}>Long / Short</button><button type="button" className={kind === "spot" ? "is-selected" : ""} onClick={() => setKind("spot")}>Buy / Sell</button></div>
      <div className="wallet-ticket-row"><span>{kind === "directional" ? "Stake" : "Amount"}</span><label className="wallet-input-wrap"><input value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" aria-label={kind === "directional" ? "Stake" : "Amount"} /><span>{kind === "directional" ? "embers" : asset}</span></label></div>
      {kind === "directional" && <div className="wallet-ticket-row"><span>Leverage</span><div className="wallet-leverage-picker">{["10", "50", "100"].map((value) => <button type="button" key={value} className={leverage === value ? "is-selected" : ""} onClick={() => setLeverage(value)}>{value}×</button>)}</div></div>}
      <div className="wallet-actions">{(kind === "directional" ? [["long", "Long", "↗"], ["short", "Short", "↘"]] : [["buy", "Buy", "↗"], ["sell", "Sell", "↘"]]).map(([side, label, icon]) => <button type="button" key={side} className={`wallet-side-button ${side === "long" || side === "buy" ? "is-long" : "is-short"}`} disabled={!wallet.address} onClick={() => trade(side as Side)}><span>{label}</span><span>{icon}</span></button>)}</div>
      <p className="wallet-ticket-note">{wallet.address ? kind === "directional" ? `Opens ${asset} Pulse at ${leverage}× leverage.` : `Spot ${asset} orders need a connected trading venue.` : "Connect your wallet to unlock the ticket."}</p>
      {notice && <p className="wallet-notice" role="status">{notice}</p>}
    </section>}
  </>;
}
