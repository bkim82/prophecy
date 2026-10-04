"use client";

import { useState } from "react";
import { ActionSheet } from "./ActionSheet";
import type { Coin } from "./types";

// Deposit/Send/Swap are UI-only this pass (see docs/wallet.md): Deposit shows
// the real connected address (safe, already-public data) with copy-to-clipboard;
// Send/Swap collect inputs but never call eth_sendTransaction or any swap router.

export function DepositSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };
  return (
    <ActionSheet title="Deposit" onClose={onClose}>
      <p className="wd-sheet-copy">Send ETH or any Base token to your connected address.</p>
      <div className="wd-sheet-address">
        <code>{address}</code>
        <button type="button" onClick={copy} className="wd-sheet-primary-button">{copied ? "Copied" : "Copy address"}</button>
      </div>
      <p className="wd-sheet-note">Base network only — sending from another chain may not arrive.</p>
    </ActionSheet>
  );
}

export function SendSheet({ coins, onClose }: { coins: Coin[]; onClose: () => void }) {
  const [asset, setAsset] = useState(coins[0]?.symbol ?? "ETH");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <ActionSheet title="Send" onClose={onClose}>
      {sent ? (
        <p className="wd-sheet-note">Sending isn&apos;t wired up yet — this is a preview of the flow, no funds moved.</p>
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => { event.preventDefault(); setSent(true); }}
        >
          <label className="wd-sheet-field">
            <span>Asset</span>
            <select value={asset} onChange={(event) => setAsset(event.target.value)}>
              {coins.map((coin) => <option key={coin.address} value={coin.symbol}>{coin.symbol}</option>)}
            </select>
          </label>
          <label className="wd-sheet-field">
            <span>To address</span>
            <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
          <label className="wd-sheet-field">
            <span>Amount</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled={!to || !amount}>Review send</button>
        </form>
      )}
    </ActionSheet>
  );
}

/**
 * `extraToken` covers the Advanced tab's case: buying/selling a token that
 * isn't (yet) in `coins` (the wallet's owned holdings), so it still shows up
 * as a pickable option. `initialFrom`/`initialTo` preselect a side (e.g. the
 * token a Buy/Sell button was pressed on) without locking the picker.
 */
export function SwapSheet({
  coins,
  extraToken,
  initialFrom,
  initialTo,
  onClose,
}: {
  coins: Coin[];
  extraToken?: { symbol: string };
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
}) {
  const options = Array.from(new Set([...coins.map((coin) => coin.symbol), ...(extraToken ? [extraToken.symbol] : [])]));
  const [from, setFrom] = useState(initialFrom ?? options[0] ?? "ETH");
  const [to, setTo] = useState(initialTo ?? options[1] ?? options[0] ?? "ETH");
  const [amount, setAmount] = useState("");
  const [swapped, setSwapped] = useState(false);

  return (
    <ActionSheet title="Swap" onClose={onClose}>
      {swapped ? (
        <p className="wd-sheet-note">Swapping isn&apos;t wired up yet — this is a preview of the flow, no funds moved.</p>
      ) : (
        <form
          className="wd-sheet-form"
          onSubmit={(event) => { event.preventDefault(); setSwapped(true); }}
        >
          <label className="wd-sheet-field">
            <span>From</span>
            <select value={from} onChange={(event) => setFrom(event.target.value)}>
              {options.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <button type="button" className="wd-sheet-swap-flip" onClick={() => { setFrom(to); setTo(from); }} aria-label="Reverse swap direction">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 6h7L9.5 3.5M11 10H4l2.5 2.5" />
            </svg>
          </button>
          <label className="wd-sheet-field">
            <span>To</span>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              {options.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <label className="wd-sheet-field">
            <span>Amount</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0" />
          </label>
          <button type="submit" className="wd-sheet-primary-button" disabled={!amount || from === to}>Review swap</button>
        </form>
      )}
    </ActionSheet>
  );
}
