"use client";

import { useState } from "react";
import { MarketChart } from "@/app/MarketChart";
import { CoinImage, Change, usd as formatUnitPrice } from "@/app/duel/portfolio/ui";
import type { Coin } from "./types";
import { WALLET_HISTORY_PERIODS, useWalletHistory, type WalletHistoryPeriod } from "./useWalletHistory";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const qty = (n: number) => (n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 6 }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CHART_WINDOWS: Record<WalletHistoryPeriod, { ms: number; tickMs: number; label: string; dates: boolean }> = {
  "1h": { ms: HOUR, tickMs: 10 * 60_000, label: "hour", dates: false },
  "24h": { ms: DAY, tickMs: 4 * HOUR, label: "24 hours", dates: false },
  "7d": { ms: 7 * DAY, tickMs: DAY, label: "7 days", dates: true },
  "30d": { ms: 30 * DAY, tickMs: 7 * DAY, label: "30 days", dates: true },
};
const formatChartTime = (dates: boolean) => (t: number) =>
  new Date(t).toLocaleString("en-US", dates ? { month: "short", day: "numeric" } : { hour12: false, hour: "2-digit", minute: "2-digit" });

export function CoinDetailPanel({
  coin,
  sharePct,
  onClose,
  onBuy,
  onSell,
  onSend,
}: {
  coin: Coin;
  sharePct: number;
  onClose: () => void;
  onBuy: () => void;
  onSell: () => void;
  onSend: () => void;
}) {
  const [period, setPeriod] = useState<WalletHistoryPeriod>("24h");
  const history = useWalletHistory([coin.address], period);
  const closes = history.lookup(coin.address);
  const now = Date.now();
  const chartWindow = CHART_WINDOWS[period];
  const livePrice = coin.priceUsd ?? 0;

  // Cheap enough (closes.length is at most a few dozen) to rebuild per render
  // rather than memoize — memoizing would need `now` in the deps anyway,
  // which changes every render and defeats the point.
  const chartPoints = (() => {
    if (!closes || closes.length < 2) return [];
    const step = chartWindow.ms / closes.length;
    const start = now - chartWindow.ms;
    const points = closes.map((p, i) => ({ t: start + i * step, p }));
    points.push({ t: now, p: livePrice > 0 ? livePrice : closes[closes.length - 1] });
    return points;
  })();

  const periodChange = closes && closes.length >= 2 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : null;

  return (
    <section className="wd-detail" aria-label={`${coin.name} details`}>
      <button type="button" onClick={onClose} className="wd-detail-back">
        <span aria-hidden="true">&larr;</span> Back to holdings
      </button>

      <div className="wd-detail-head">
        <CoinImage src={coin.imageUrl} symbol={coin.symbol} size={44} />
        <div>
          <h2>{coin.name}</h2>
          <p>{coin.symbol} &middot; {qty(coin.qty)} held</p>
        </div>
      </div>

      <div className="wd-detail-price">
        <span className="tabular-nums">{coin.valueUsd != null ? usd(coin.valueUsd) : "—"}</span>
        <Change value={coin.change24h} label="24h" digits={2} />
        {period !== "24h" && <Change value={periodChange} label={period} digits={2} />}
      </div>

      <div className="wd-detail-chart">
        <div className="wd-detail-periods" role="group" aria-label="Chart period">
          {WALLET_HISTORY_PERIODS.map((option) => (
            <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)} className={period === option ? "is-selected" : ""}>
              {option}
            </button>
          ))}
        </div>
        {history.status(coin.address) === "none" ? (
          <div className="wd-detail-chart-empty">No {period} price history for this coin yet</div>
        ) : (
          <MarketChart
            points={chartPoints}
            now={now}
            label={`${coin.symbol} ${period}`}
            tickSize={livePrice > 0 ? livePrice * 1e-4 : 1e-12}
            height={260}
            windowMs={chartWindow.ms}
            tickMs={chartWindow.tickMs}
            windowLabel={chartWindow.label}
            formatPrice={(price) => (price > 0 ? formatUnitPrice(price) : "$0")}
            formatTime={formatChartTime(chartWindow.dates)}
            smooth={false}
          />
        )}
      </div>

      <dl className="wd-detail-stats">
        <div><dt>Unit price</dt><dd>{livePrice > 0 ? formatUnitPrice(livePrice) : "—"}</dd></div>
        <div><dt>Quantity</dt><dd>{qty(coin.qty)}</dd></div>
        <div><dt>% of portfolio</dt><dd>{sharePct.toFixed(1)}%</dd></div>
      </dl>
      <p className="wd-detail-note">
        Average entry and total return aren&apos;t tracked for this holding — Prophecy only knows the balance currently in your
        connected wallet, not what you originally paid for it.
      </p>

      <div className="wd-detail-actions">
        <button type="button" onClick={onBuy} className="wd-sheet-primary-button">Buy</button>
        <button type="button" onClick={onSell} className="wd-detail-secondary-button">Sell</button>
        <button type="button" onClick={onSend} className="wd-detail-secondary-button">Send</button>
      </div>
    </section>
  );
}
