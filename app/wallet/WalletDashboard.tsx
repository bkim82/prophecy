"use client";

import { useCallback, useEffect, useState } from "react";
import type { WalletState } from "@/app/lib/useWalletConnection";
import { shortenAddress } from "@/app/lib/wallet";
import type { WalletTokenHolding } from "@/lib/alchemy";
import { AdvancedTab } from "./AdvancedTab";
import { DepositSheet, SendSheet, SwapSheet } from "./ActionSheets";
import { ActivityList } from "./ActivityList";
import { BalanceChip } from "./BalanceChip";
import { CoinDetailPanel } from "./CoinDetailPanel";
import { CoinList } from "./CoinList";
import { ETH_SENTINEL, type Coin } from "./types";

// Holdings hit Alchemy (metered), so they poll slower than the ETH quote and only while the tab is visible.
const HOLDINGS_POLL_MS = 30_000;
const ETH_POLL_MS = 10_000;

type EthSummary = { priceUsd: number; change24h: number | null; imageUrl: string | null };
type Tab = "portfolio" | "activity" | "advanced";
type MarketToken = { address: string; symbol: string; priceUsd: number | null };
type SwapPreset = { initialFrom?: string; initialTo?: string; extraToken?: MarketToken };

export function WalletDashboard({
  wallet,
  signOut,
}: {
  wallet: WalletState;
  signOut: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [tokenHoldings, setTokenHoldings] = useState<WalletTokenHolding[]>([]);
  const [eth, setEth] = useState<EthSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"deposit" | "send" | "swap" | null>(null);
  const [swapPreset, setSwapPreset] = useState<SwapPreset | null>(null);
  // Bumped when a local intent reaches inclusion so holdings refresh without waiting out the poll.
  const [holdingsNonce, setHoldingsNonce] = useState(0);
  const refreshHoldings = useCallback(() => setHoldingsNonce((n) => n + 1), []);

  const onBase = wallet.chainId === 8453;
  const address = wallet.address;

  useEffect(() => {
    if (!address || !onBase) { setTokenHoldings([]); return; }
    let cancelled = false;
    const load = () => fetch(`/api/wallet/holdings?address=${address}`)
      .then((res) => (res.ok ? res.json() : { holdings: [] }))
      .then((data: { holdings?: WalletTokenHolding[] }) => { if (!cancelled) setTokenHoldings(data.holdings ?? []); })
      .catch(() => { if (!cancelled) setTokenHoldings([]); });
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, HOLDINGS_POLL_MS);
    // Catch up immediately when the tab comes back instead of waiting out the interval.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [address, onBase, holdingsNonce]);

  useEffect(() => {
    if (!onBase) { setEth(null); return; }
    let cancelled = false;
    const load = () => fetch("/api/wallet/eth")
      .then((res) => (res.ok ? res.json() : { eth: null }))
      .then((data: { eth?: EthSummary | null }) => { if (!cancelled) setEth(data.eth ?? null); })
      .catch(() => { if (!cancelled) setEth(null); });
    load();
    const id = setInterval(load, ETH_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [onBase]);

  if (!address) return null;

  const ethQty = Number(wallet.balance ?? "0");
  const coins: Coin[] = [
    {
      address: ETH_SENTINEL,
      symbol: "ETH",
      name: "Ether",
      imageUrl: eth?.imageUrl ?? null,
      qty: ethQty,
      priceUsd: eth?.priceUsd ?? null,
      valueUsd: eth?.priceUsd != null ? ethQty * eth.priceUsd : null,
      change24h: eth?.change24h ?? null,
    },
    ...tokenHoldings.map((holding): Coin => ({
      // Lowercased to match market/search addresses, so a held token is found as owned (and sellable) everywhere.
      address: holding.address.toLowerCase(),
      symbol: holding.symbol,
      name: holding.name,
      imageUrl: holding.imageUrl,
      qty: holding.balance,
      priceUsd: holding.priceUsd,
      valueUsd: holding.valueUsd,
      change24h: holding.change24h,
    })),
  ].filter((coin) => coin.qty > 0);

  const totalUsd = coins.reduce((sum, coin) => sum + (coin.valueUsd ?? 0), 0);
  let yesterdayTotal = 0;
  let hasKnownChange = false;
  for (const coin of coins) {
    const value = coin.valueUsd ?? 0;
    if (coin.change24h != null && value > 0) {
      hasKnownChange = true;
      yesterdayTotal += value / (1 + coin.change24h / 100);
    } else {
      yesterdayTotal += value;
    }
  }
  const changeUsd = hasKnownChange ? totalUsd - yesterdayTotal : null;
  const changePct = hasKnownChange && yesterdayTotal > 0 ? (changeUsd! / yesterdayTotal) * 100 : null;

  const selectedCoin = selected ? coins.find((coin) => coin.address === selected) ?? null : null;
  const selectedShare = selectedCoin && totalUsd > 0 ? ((selectedCoin.valueUsd ?? 0) / totalUsd) * 100 : 0;

  const closeSheet = () => { setSheet(null); setSwapPreset(null); };
  const openBuy = (token: MarketToken) => {
    setSwapPreset({ initialTo: token.address, extraToken: token });
    setSheet("swap");
  };
  const openSell = (token: MarketToken) => {
    // No extraToken: an unheld token can't be sold, and selling must not turn it into a buy target.
    setSwapPreset({ initialFrom: token.address });
    setSheet("swap");
  };

  return (
    <div className="wd-dashboard">
      <div className="wd-connection-strip">
        <span className="wd-status-dot" aria-hidden="true" />
        <span>{shortenAddress(address)}</span>
        <span>Base</span>
        <button type="button" onClick={() => void signOut()} className="wd-strip-link">Sign out</button>
      </div>

      <div className="wd-tabs" role="group" aria-label="Wallet view">
        <button type="button" className={tab === "portfolio" ? "active" : ""} aria-pressed={tab === "portfolio"} onClick={() => setTab("portfolio")}>
          Portfolio
        </button>
        <button type="button" className={tab === "activity" ? "active" : ""} aria-pressed={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </button>
        <button type="button" className={tab === "advanced" ? "active" : ""} aria-pressed={tab === "advanced"} onClick={() => setTab("advanced")}>
          Advanced
        </button>
      </div>

      {tab === "portfolio" ? (
        <div className="wd-portfolio">
          {selectedCoin ? (
            <CoinDetailPanel
              coin={selectedCoin}
              sharePct={selectedShare}
              onClose={() => setSelected(null)}
              onBuy={() => openBuy(selectedCoin)}
              onSell={() => openSell(selectedCoin)}
              onSend={() => setSheet("send")}
            />
          ) : (
            <>
              <BalanceChip
                totalUsd={totalUsd}
                changeUsd={changeUsd}
                changePct={changePct}
                onDeposit={() => setSheet("deposit")}
                onSend={() => setSheet("send")}
                onSwap={() => setSheet("swap")}
              />

              {!onBase ? (
                <p className="wd-empty">Switch to Base to see your holdings.</p>
              ) : (
                <CoinList coins={coins} totalUsd={totalUsd} onSelect={setSelected} />
              )}
            </>
          )}
        </div>
      ) : tab === "activity" ? (
        <ActivityList address={address} onIncluded={refreshHoldings} />
      ) : (
        <AdvancedTab coins={coins} onBuy={openBuy} onSell={openSell} />
      )}

      {sheet === "deposit" && <DepositSheet address={address} onClose={closeSheet} />}
      {sheet === "send" && <SendSheet accountAddress={address} coins={coins} initialAsset={selected ?? undefined} onClose={closeSheet} />}
      {sheet === "swap" && (
        <SwapSheet accountAddress={address} coins={coins} initialFrom={swapPreset?.initialFrom} initialTo={swapPreset?.initialTo} extraToken={swapPreset?.extraToken} onClose={closeSheet} />
      )}
    </div>
  );
}
