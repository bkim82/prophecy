"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isBaseChain, shortenAddress } from "@/app/lib/wallet";
import { useWalletConnection } from "@/app/lib/useWalletConnection";
import type { WalletTokenHolding } from "@/lib/alchemy";

type TicketKind = "directional" | "spot";
type Side = "long" | "short" | "buy" | "sell";

const ASSETS = ["BTC", "ETH", "Other"];

const formatQty = (n: number) => (n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));
const formatUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 });

export function WalletDesk({ showHoldings = false, showConnection = true, showTicket = true }: { showHoldings?: boolean; showConnection?: boolean; showTicket?: boolean }) {
  const router = useRouter();
  const { wallet, notice, setNotice, connecting, switching, connect, disconnectWallet: disconnectConnection, switchWallet, switchNetwork } = useWalletConnection();
  const [tokenHoldings, setTokenHoldings] = useState<WalletTokenHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [asset, setAsset] = useState("BTC");
  const [kind, setKind] = useState<TicketKind>("directional");
  const [stake, setStake] = useState("25");
  const [leverage, setLeverage] = useState("100");

  useEffect(() => {
    if (!wallet.address || !wallet.chainId || !isBaseChain(wallet.chainId)) { setTokenHoldings([]); return; }
    let cancelled = false;
    setHoldingsLoading(true);
    fetch(`/api/wallet/holdings?address=${wallet.address}`)
      .then((res) => (res.ok ? res.json() : { holdings: [] }))
      .then((data: { holdings?: WalletTokenHolding[] }) => { if (!cancelled) setTokenHoldings(data.holdings ?? []); })
      .catch(() => { if (!cancelled) setTokenHoldings([]); })
      .finally(() => { if (!cancelled) setHoldingsLoading(false); });
    return () => { cancelled = true; };
  }, [wallet.address, wallet.chainId]);

  const disconnectWallet = async () => {
    await disconnectConnection();
    setTokenHoldings([]);
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
      {wallet.address ? <><div className="wallet-address">{shortenAddress(wallet.address)}</div><div className="wallet-meta"><span>{wallet.chain}</span><span>{wallet.balance ?? "—"} ETH</span></div>
        {wallet.chainId && !isBaseChain(wallet.chainId) && <div className="wallet-notice" role="status"><span>Prophecy runs on Base — you&apos;re connected to {wallet.chain}.</span><button type="button" className="wallet-secondary-button" onClick={switchNetwork} disabled={switching}>{switching ? "Switching…" : "Switch to Base"}</button></div>}
        <div className="wallet-button-row"><button type="button" className="wallet-secondary-button" onClick={switchWallet}>Switch wallet</button><button type="button" className="wallet-secondary-button" onClick={disconnectWallet}>Disconnect</button></div></> : <><p className="wallet-card-copy">Scan with Coinbase Wallet, or create one instantly with a passkey. Prophecy never asks for your seed phrase.</p><button type="button" className="wallet-connect-button" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button></>}
      {notice && <p className="wallet-notice" role="status">{notice}</p>}
    </section>}

    {showHoldings && wallet.address && <section className="panel wallet-card wallet-holdings">
      <div className="wallet-ticket-heading"><div><span className="eyebrow">Portfolio</span><h2>Current holdings</h2></div><span className="wallet-live-dot">Wallet</span></div>
      <div className="wallet-holding-list">
        <div className="wallet-holding-row"><span><strong>ETH</strong><small>Ether</small></span><span className="wallet-ticket-value">{wallet.balance ?? "—"}</span></div>
        {tokenHoldings.map((item) => <div className="wallet-holding-row" key={item.address}><span><strong>{item.symbol}</strong><small>{item.name}</small></span><span className="wallet-ticket-value">{formatQty(item.balance)}{item.valueUsd != null && <small> · {formatUsd(item.valueUsd)}</small>}</span></div>)}
      </div>
      {!wallet.chainId || !isBaseChain(wallet.chainId) ? <p className="wallet-ticket-note">Switch to Base to see your token holdings.</p>
        : holdingsLoading ? <p className="wallet-ticket-note">Loading token holdings…</p>
        : tokenHoldings.length === 0 && <p className="wallet-ticket-note">No Base tokens found for this wallet yet.</p>}
    </section>}

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
