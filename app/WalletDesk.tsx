"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { chainName, formatEth, getWalletProvider, isBaseChain, shortenAddress, switchToBase, type EthereumProvider } from "@/app/lib/wallet";
import type { WalletTokenHolding } from "@/lib/alchemy";

type WalletState = { address: string | null; chainId: string | null; chain: string | null; balance: string | null };
type TicketKind = "directional" | "spot";
type Side = "long" | "short" | "buy" | "sell";

const EMPTY_WALLET: WalletState = { address: null, chainId: null, chain: null, balance: null };
const ASSETS = ["BTC", "ETH", "Other"];

const formatQty = (n: number) => (n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));
const formatUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 });

export function WalletDesk({ showHoldings = false, showConnection = true, showTicket = true }: { showHoldings?: boolean; showConnection?: boolean; showTicket?: boolean }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [tokenHoldings, setTokenHoldings] = useState<WalletTokenHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [asset, setAsset] = useState("BTC");
  const [kind, setKind] = useState<TicketKind>("directional");
  const [stake, setStake] = useState("25");
  const [leverage, setLeverage] = useState("100");
  // Coinbase Wallet SDK's Smart Wallet signer throws (code 4100) if `eth_accounts` is
  // called before `eth_requestAccounts` has ever succeeded this session, and it also
  // can't handle a second request while one is already in flight — set while a
  // connect/switch handshake is running so the chainChanged listener doesn't race it.
  const handshakeInFlight = useRef(false);

  const refreshWallet = async (provider: EthereumProvider, address?: string) => {
    let accounts: string[];
    if (address) {
      accounts = [address];
    } else {
      try { accounts = await provider.request({ method: "eth_accounts" }) as string[]; }
      catch { setWallet(EMPTY_WALLET); return; }
    }
    if (!accounts[0]) { setWallet(EMPTY_WALLET); return; }
    let chainId: string;
    let balance: string;
    try {
      chainId = await provider.request({ method: "eth_chainId" }) as string;
      balance = await provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
    } catch { return; } // mid-handshake race (SDK not yet marked authorized) — the next event/poll retries
    const eth = formatEth(balance);
    setWallet({ address: accounts[0], chainId, chain: chainName(chainId), balance: eth });
    window.dispatchEvent(new Event("wallet-updated"));
  };

  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    void refreshWallet(provider);
    const onAccountsChanged = (...args: unknown[]) => { if (!handshakeInFlight.current) void refreshWallet(provider, (args[0] as string[])[0]); };
    const onChainChanged = () => { if (!handshakeInFlight.current) void refreshWallet(provider); };
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => { provider.removeListener?.("accountsChanged", onAccountsChanged); provider.removeListener?.("chainChanged", onChainChanged); };
  }, []);

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

  const connect = async () => {
    const provider = getWalletProvider();
    if (!provider) { setNotice("Wallet connection isn't available right now."); return; }
    setConnecting(true); setNotice(null); handshakeInFlight.current = true;
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      await refreshWallet(provider, accounts[0]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Wallet connection was cancelled."); }
    finally { setConnecting(false); handshakeInFlight.current = false; }
  };

  const disconnectWallet = async () => {
    const provider = getWalletProvider();
    if (provider) { try { await provider.disconnect?.(); } catch { /* already disconnected */ } }
    setWallet(EMPTY_WALLET);
    setTokenHoldings([]);
    setNotice(null);
    window.dispatchEvent(new Event("wallet-updated"));
  };

  const switchWallet = async () => {
    const provider = getWalletProvider();
    if (!provider) return;
    try { await provider.disconnect?.(); } catch { /* already disconnected */ }
    setWallet(EMPTY_WALLET);
    await connect();
  };

  const switchNetwork = async () => {
    const provider = getWalletProvider();
    if (!provider) return;
    setSwitching(true); setNotice(null); handshakeInFlight.current = true;
    try { await switchToBase(provider); await refreshWallet(provider); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Couldn't switch to Base. Switch networks from your wallet instead."); }
    finally { setSwitching(false); handshakeInFlight.current = false; }
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
