"use client";

import { useCallback, useEffect, useState } from "react";
import { BackIcon, LockIcon, SearchIcon } from "@/app/icons";
import type { WalletState } from "@/app/lib/useWalletConnection";
import { USDC_BASE } from "@/app/lib/embeddedWallet/tokens";
import { shortenAddress } from "@/app/lib/wallet";
import type { WalletTokenHolding } from "@/lib/alchemy";
import { AdvancedTab } from "./AdvancedTab";
import { DepositSheet, SendSheet, SwapSheet } from "./ActionSheets";
import { ActivityList, ExternalArrow, activityAmount, useWalletActivity, type ActivityEntry } from "./ActivityList";
import { BalanceCard, type BalanceChip } from "./BalanceCard";
import { CoinDetailPanel } from "./CoinDetailPanel";
import { CoinList } from "./CoinList";
import { useHiddenCoins } from "./hiddenCoins";
import { ETH_SENTINEL, type Coin } from "./types";

// Holdings hit Alchemy (metered), so they poll slower than the ETH quote and only while the tab is visible.
const HOLDINGS_POLL_MS = 30_000;
const ETH_POLL_MS = 10_000;
// Opening Deposit starts a watch that keeps polling activity faster (even with the sheet closed) until
// a new incoming transfer shows up or this long passes.
const DEPOSIT_WATCH_MS = 15 * 60_000;
const ARRIVAL_TOAST_MS = 8_000;
const RECENT_ACTIVITY_ROWS = 4;

type EthSummary = { priceUsd: number; change24h: number | null; imageUrl: string | null };
type View = "home" | "activity" | "explore";
type MarketToken = { address: string; symbol: string; priceUsd: number | null };
type SwapPreset = { initialFrom?: string; initialTo?: string; extraToken?: MarketToken };
/** Incoming chain transfers already known when the watch started; anything new after that is the deposit. */
type DepositWatch = { baseline: Set<string> | null };

const receivedHashes = (entries: ActivityEntry[]) =>
  new Set(entries.filter((entry) => !entry.local && entry.kind === "received").map((entry) => entry.hash));

const TRUST_POINTS = [
  { icon: <LockIcon className="h-4 w-4" />, title: "Your wallet, your keys", body: "Funds sit in a wallet only you can sign for. Prophecy never sees your key and can't move them." },
  { icon: <ExternalArrow />, title: "Withdraw anytime", body: "No lockups or holds. Send any amount out of this wallet whenever you like." },
  { icon: <SearchIcon className="h-4 w-4" />, title: "Verifiable on Base", body: "Every confirmed deposit and withdrawal links to its onchain record on Basescan." },
];

/** Fixtures that replace the wallet-specific reads (see mockWallet.ts); market data stays live. */
export type WalletMock = { holdings: WalletTokenHolding[]; activity: ActivityEntry[] };

export function WalletDashboard({
  wallet,
  signOut,
  mock,
}: {
  wallet: WalletState;
  signOut: () => Promise<void>;
  mock?: WalletMock;
}) {
  const [view, setView] = useState<View>("home");
  const [tokenHoldings, setTokenHoldings] = useState<WalletTokenHolding[]>([]);
  const [holdingsLoaded, setHoldingsLoaded] = useState(false);
  const [eth, setEth] = useState<EthSummary | null>(null);
  const [ethLoaded, setEthLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"deposit" | "send" | "swap" | null>(null);
  const [swapPreset, setSwapPreset] = useState<SwapPreset | null>(null);
  const [watch, setWatch] = useState<DepositWatch | null>(null);
  const [dismissedArrival, setDismissedArrival] = useState<string | null>(null);
  // Bumped when a local intent reaches inclusion so holdings refresh without waiting out the poll.
  const [holdingsNonce, setHoldingsNonce] = useState(0);
  const refreshHoldings = useCallback(() => setHoldingsNonce((n) => n + 1), []);
  const { isHidden, toggle: toggleHidden } = useHiddenCoins();

  const onBase = wallet.chainId === 8453;
  const address = wallet.address;

  // Deposit watch, adjusted during render: a watch started before activity first loaded takes its
  // baseline from that load, and `activityFast` mirrors `watching` so polling speeds up only until arrival.
  const [activityFast, setActivityFast] = useState(false);
  const liveActivity = useWalletActivity(mock ? null : address, { onIncluded: refreshHoldings, fast: activityFast });
  const activity = mock ? { entries: mock.activity, failed: false } : liveActivity;
  if (watch && !watch.baseline && activity.entries) setWatch({ baseline: receivedHashes(activity.entries) });
  const arrivalEntry = watch?.baseline
    ? activity.entries?.find((entry) => !entry.local && entry.kind === "received" && !watch.baseline!.has(entry.hash)) ?? null
    : null;
  const watching = watch !== null && arrivalEntry === null;
  if (activityFast !== watching) setActivityFast(watching);
  const arrivalHash = arrivalEntry?.hash ?? null;

  useEffect(() => {
    if (!address || !onBase) { setTokenHoldings([]); return; }
    if (mock) { setTokenHoldings(mock.holdings); setHoldingsLoaded(true); return; }
    let cancelled = false;
    const load = () => fetch(`/api/wallet/holdings?address=${address}`)
      .then((res) => (res.ok ? res.json() : { holdings: [] }))
      .then((data: { holdings?: WalletTokenHolding[] }) => { if (!cancelled) setTokenHoldings(data.holdings ?? []); })
      .catch(() => { if (!cancelled) setTokenHoldings([]); })
      .finally(() => { if (!cancelled) setHoldingsLoaded(true); });
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, HOLDINGS_POLL_MS);
    // Catch up immediately when the tab comes back instead of waiting out the interval.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [address, onBase, holdingsNonce, arrivalHash, mock]);

  useEffect(() => {
    if (!onBase) { setEth(null); return; }
    let cancelled = false;
    const load = () => fetch("/api/wallet/eth")
      .then((res) => (res.ok ? res.json() : { eth: null }))
      .then((data: { eth?: EthSummary | null }) => { if (!cancelled) setEth(data.eth ?? null); })
      .catch(() => { if (!cancelled) setEth(null); })
      .finally(() => { if (!cancelled) setEthLoaded(true); });
    load();
    const id = setInterval(load, ETH_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [onBase]);

  useEffect(() => {
    if (!watch) return;
    const id = setTimeout(() => setWatch(null), DEPOSIT_WATCH_MS);
    return () => clearTimeout(id);
  }, [watch]);

  // A landed deposit also reloads holdings (arrivalHash is in that effect's deps) and the header balance.
  useEffect(() => {
    if (arrivalHash) window.dispatchEvent(new Event("wallet-updated"));
  }, [arrivalHash]);

  const toastVisible = arrivalHash !== null && sheet !== "deposit" && dismissedArrival !== arrivalHash;
  useEffect(() => {
    if (!toastVisible) return;
    const id = setTimeout(() => setDismissedArrival(arrivalHash), ARRIVAL_TOAST_MS);
    return () => clearTimeout(id);
  }, [toastVisible, arrivalHash]);

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

  // USDC is the wallet's cash: shown in the balance card, never hideable, and never in Holdings.
  const usdcCoin = coins.find((coin) => coin.address === USDC_BASE) ?? null;
  const cashUsd = usdcCoin ? usdcCoin.valueUsd ?? usdcCoin.qty : 0;
  const ethCoin = coins.find((coin) => coin.address === ETH_SENTINEL) ?? null;
  const balanceChips: BalanceChip[] = [
    {
      label: "Gas",
      symbol: "ETH",
      usdValue: ethCoin?.valueUsd ?? 0,
      imageUrl: ethCoin?.imageUrl ?? eth?.imageUrl ?? null,
      onSelect: ethCoin ? () => setSelected(ETH_SENTINEL) : undefined,
    },
    {
      label: "Cash",
      symbol: "USDC",
      usdValue: cashUsd,
      imageUrl: usdcCoin?.imageUrl ?? null,
      onSelect: usdcCoin ? () => setSelected(USDC_BASE) : undefined,
    },
  ];
  const holdingCoins = coins.filter((coin) => coin.address !== USDC_BASE);

  // Hidden coins (usually spam airdrops) stay in `coins` for Send/Swap but don't count toward the balance.
  const countedCoins = coins.filter((coin) => coin === usdcCoin || !isHidden(coin.address));
  const totalUsd = countedCoins.reduce((sum, coin) => sum + (coin.valueUsd ?? 0), 0);
  let yesterdayTotal = 0;
  let hasKnownChange = false;
  for (const coin of countedCoins) {
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
  const subline = countedCoins.length === 0
    ? "No funds yet"
    : countedCoins.length === 1
      ? `${activityAmount(countedCoins[0].qty, countedCoins[0].symbol)} on Base`
      : `Across ${countedCoins.length} assets on Base`;

  const selectedCoin = selected ? coins.find((coin) => coin.address === selected) ?? null : null;
  const selectedShare = selectedCoin && countedCoins.includes(selectedCoin) && totalUsd > 0 ? ((selectedCoin.valueUsd ?? 0) / totalUsd) * 100 : 0;
  const arrival = arrivalEntry ? { value: arrivalEntry.value, asset: arrivalEntry.asset } : null;

  const openDeposit = () => {
    // Re-baseline unless a watch is still waiting, so a deposit already shown doesn't count twice.
    if (!watching) setWatch({ baseline: activity.entries ? receivedHashes(activity.entries) : null });
    setSheet("deposit");
  };
  const closeSheet = () => {
    // The sheet already showed the arrival; no toast for it on the way out.
    if (sheet === "deposit" && arrivalHash) setDismissedArrival(arrivalHash);
    setSheet(null);
    setSwapPreset(null);
  };
  const openBuy = (token: MarketToken) => {
    setSwapPreset({ initialTo: token.address, extraToken: token });
    setSheet("swap");
  };
  const openSell = (token: MarketToken) => {
    // No extraToken: an unheld token can't be sold, and selling must not turn it into a buy target.
    setSwapPreset({ initialFrom: token.address });
    setSheet("swap");
  };
  const openExplore = () => setView("explore");
  const goHome = () => { setView("home"); setSelected(null); };

  return (
    <div className="wd-dashboard">
      <header className="wd-header">
        {view === "home" ? (
          <h1>Wallet</h1>
        ) : (
          <div className="wd-header-sub">
            <button type="button" className="wd-detail-back" onClick={goHome}><BackIcon className="h-3.5 w-3.5" /> Wallet</button>
            <h1>{view === "activity" ? "Activity" : "Explore tokens"}</h1>
          </div>
        )}
        <AddressPill address={address} />
      </header>

      {view === "activity" ? (
        <div className="wd-card">
          <ActivityList entries={activity.entries} failed={activity.failed} />
        </div>
      ) : view === "explore" ? (
        <AdvancedTab coins={coins} onBuy={openBuy} onSell={openSell} />
      ) : selectedCoin ? (
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
          <BalanceCard
            totalUsd={totalUsd}
            chips={balanceChips}
            loaded={!onBase || (holdingsLoaded && ethLoaded)}
            subline={subline}
            changeUsd={changeUsd}
            changePct={changePct}
            onDeposit={openDeposit}
            onWithdraw={() => setSheet("send")}
            menu={[
              { label: "Swap tokens", onSelect: () => setSheet("swap") },
              { label: "Explore tokens", onSelect: openExplore },
              { label: "Sign out", onSelect: () => void signOut() },
            ]}
          />

          <section className="wd-section" aria-labelledby="wd-holdings-title">
            <div className="wd-section-row">
              <h2 id="wd-holdings-title">Holdings</h2>
              <button type="button" className="wd-text-link" onClick={openExplore}>Explore tokens</button>
            </div>
            {!onBase ? (
              <div className="wd-card"><p className="wd-card-empty">Switch to Base to see your holdings.</p></div>
            ) : (
              <CoinList coins={holdingCoins} isHidden={isHidden} onToggleHidden={toggleHidden} onSelect={setSelected} onExplore={openExplore} />
            )}
          </section>

          <section className="wd-section" aria-labelledby="wd-activity-title">
            <div className="wd-section-row">
              <h2 id="wd-activity-title">Recent activity</h2>
              <button type="button" className="wd-text-link" onClick={() => setView("activity")}>View all</button>
            </div>
            <div className="wd-card">
              <ActivityList entries={activity.entries} failed={activity.failed} limit={RECENT_ACTIVITY_ROWS} />
            </div>
          </section>

          <ul className="wd-trust" aria-label="How your wallet is protected">
            {TRUST_POINTS.map((point) => (
              <li key={point.title}>
                <span className="wd-trust-icon" aria-hidden="true">{point.icon}</span>
                <span>
                  <strong>{point.title}</strong>
                  <small>{point.body}</small>
                </span>
              </li>
            ))}
          </ul>

          <p className="wd-footnote">
            Prophecy holds no funds on your behalf. Balances are read live from Base.{" "}
            <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noopener noreferrer" className="wd-text-link">
              See this wallet on Basescan <ExternalArrow />
            </a>
          </p>
        </>
      )}

      {sheet === "deposit" && <DepositSheet address={address} arrival={arrival} onClose={closeSheet} />}
      {sheet === "send" && <SendSheet accountAddress={address} coins={coins} initialAsset={selected ?? undefined} onClose={closeSheet} />}
      {sheet === "swap" && (
        <SwapSheet accountAddress={address} coins={coins} initialFrom={swapPreset?.initialFrom} initialTo={swapPreset?.initialTo} extraToken={swapPreset?.extraToken} onClose={closeSheet} />
      )}

      {toastVisible && arrival && (
        <div className="wd-toast" role="status">
          <span className="wd-toast-check" aria-hidden="true">✓</span>
          Deposit received: +{activityAmount(arrival.value, arrival.asset)}
        </div>
      )}
    </div>
  );
}

/** Network + shortened address, with copy and a Basescan link — the identity people check before depositing. */
function AddressPill({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  };
  return (
    <div className="wd-address-pill">
      <span className="wd-base-dot" aria-hidden="true" />
      <span>Base</span>
      <span className="wd-address-sep" aria-hidden="true">/</span>
      <code title={address}>{shortenAddress(address)}</code>
      <button type="button" onClick={copy} aria-label={copied ? "Address copied" : "Copy address"} title={copied ? "Copied" : "Copy address"}>
        {copied ? (
          <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4.5" /></svg>
        ) : (
          <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.5" /><path d="M9.5 4.5V3A1 1 0 0 0 8.5 2H3a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" /></svg>
        )}
      </button>
      <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noopener noreferrer" aria-label="View on Basescan" title="View on Basescan">
        <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2h4v4M12 2 6.5 7.5M10.5 8.5v2.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h2.5" /></svg>
      </a>
    </div>
  );
}
