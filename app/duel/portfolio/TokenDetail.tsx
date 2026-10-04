"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketChart } from "@/app/MarketChart";
import { OrderForm, type TradeInput } from "./OrderForm";
import type { OpenPositionView, TokenSearchResult } from "./types";
import {
  CHART_PERIODS,
  Change,
  CoinImage,
  LivePrice,
  StarButton,
  ageLabel,
  compactOrDash,
  pnlColor,
  signed,
  usd,
  useTokenHistory,
  type ChartPeriod,
} from "./ui";
import { useWatchlist } from "./watchlist";

const QUOTE_REFRESH_MS = 5000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Window length, time-axis spacing and label style per chart period. */
const CHART_WINDOWS: Record<ChartPeriod, { ms: number; tickMs: number; label: string; dates: boolean }> = {
  "1h": { ms: HOUR, tickMs: 10 * 60_000, label: "hour", dates: false },
  "24h": { ms: DAY, tickMs: 4 * HOUR, label: "24 hours", dates: false },
  "7d": { ms: 7 * DAY, tickMs: DAY, label: "7 days", dates: true },
  "30d": { ms: 30 * DAY, tickMs: 7 * DAY, label: "30 days", dates: true },
};
const formatChartTime = (dates: boolean) => (t: number) =>
  new Date(t).toLocaleString("en-US", dates ? { month: "short", day: "numeric" } : { hour12: false, hour: "2-digit", minute: "2-digit" });
const formatChartPrice = (price: number) => (price > 0 ? usd(price) : "$0");

const DEX_NAMES: Record<string, string> = {
  uniswap: "Uniswap",
  aerodrome: "Aerodrome",
  baseswap: "BaseSwap",
  sushiswap: "SushiSwap",
  pancakeswap: "PancakeSwap",
  alienbase: "Alien Base",
};
const dexName = (id: string) => DEX_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A short, strictly factual blurb built only from the market data we have. */
function describe(token: TokenSearchResult, now: number) {
  const parts = [`${token.name} (${token.symbol}) is a token on Base`];
  if (token.dexId) parts[0] += `, traded mainly on ${dexName(token.dexId)}${token.quoteSymbol ? ` against ${token.quoteSymbol}` : ""}`;
  parts[0] += ".";
  if (token.pairCreatedAt) parts.push(`Its main pool was created ${ageLabel(token.pairCreatedAt, now)} ago.`);
  if (token.liquidityUsd > 0) {
    parts.push(
      `That pool holds ${compactOrDash(token.liquidityUsd)} of liquidity${token.volume24hUsd ? ` and traded ${compactOrDash(token.volume24hUsd)} in the last 24h` : ""}.`,
    );
  }
  return parts.join(" ");
}

/**
 * The selected token: identity, live price, a chart with period switching,
 * factual context with its data source/time, a watchlist toggle, and the
 * compact order form. Crossfades when the selection changes.
 */
export function TokenDetail({
  token,
  onQuote,
  positions,
  availableCash,
  sessionEnded,
  busy,
  error,
  onSubmit,
  now,
  onBack,
  onViewPortfolio,
}: {
  token: TokenSearchResult | null;
  onQuote: (fresh: TokenSearchResult) => void;
  positions: OpenPositionView[];
  availableCash: number;
  sessionEnded: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: TradeInput) => Promise<boolean>;
  now: number;
  onBack: () => void;
  onViewPortfolio: () => void;
}) {
  const [period, setPeriod] = useState<ChartPeriod>("24h");
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const watch = useWatchlist();
  const tokenAddress = token?.address ?? null;

  // Keep the selected coin's price live while it's on screen.
  useEffect(() => {
    if (!tokenAddress) return;
    let cancelled = false;
    setQuotedAt(null);
    const refresh = async () => {
      try {
        const res = await fetch("/api/tokens/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: [tokenAddress] }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tokens?: TokenSearchResult[] };
        const fresh = data.tokens?.[0];
        if (fresh && !cancelled) {
          onQuote(fresh);
          setQuotedAt(Date.now());
        }
      } catch {
        // Keep showing the last quote.
      }
    };
    refresh();
    const id = setInterval(refresh, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tokenAddress, onQuote]);

  const history = useTokenHistory(tokenAddress ? [tokenAddress] : [], false, period);
  const closes = tokenAddress ? history.lookup(tokenAddress) : undefined;
  const livePrice = token?.priceUsd ?? 0;
  const chartWindow = CHART_WINDOWS[period];
  // History is closes only, evenly spaced across the period; the live quote is the head at `now`.
  const chartPoints = useMemo(() => {
    if (!closes || closes.length < 2) return [];
    const step = chartWindow.ms / closes.length;
    const start = now - chartWindow.ms;
    const points = closes.map((p, i) => ({ t: start + i * step, p }));
    points.push({ t: now, p: livePrice > 0 ? livePrice : closes[closes.length - 1] });
    return points;
  }, [closes, chartWindow, now, livePrice]);

  if (!token) {
    return (
      <section className="flex min-h-[320px] flex-col items-center justify-center rounded-xl lg:h-full lg:min-h-[900px] bg-[var(--surface)] px-6 py-10 text-center" aria-label="Selected token">
        <span className="flex -space-x-2" aria-hidden="true">
          <CoinImage src={null} symbol="?" size={36} />
          <CoinImage src={null} symbol="B" size={36} />
        </span>
        <p className="mt-3 text-sm font-medium text-[var(--text)]">Pick a token to see what it is and how it’s moving.</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Search or browse the list — nothing trades until you place an order.</p>
      </section>
    );
  }

  const periodChange = closes && closes.length >= 2 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : null;
  const holdings = positions.filter((position) => position.tokenAddress === token.address);
  const holdingsPnl = holdings.reduce((total, position) => total + position.unrealizedPnl, 0);
  const watched = watch.has(token.address);
  const quoteAge = quotedAt === null ? null : Math.max(0, Math.round((now - quotedAt) / 1000));

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the address is still visible in the title tooltip.
    }
  };

  return (
    <section className="rounded-xl bg-[var(--surface)] p-4 sm:p-5 lg:h-full lg:min-h-[900px]" aria-label={`${token.name} details`}>
      <button type="button" onClick={onBack} className="-ml-1 mb-3 flex min-h-9 items-center gap-1 rounded-md px-1 text-sm font-semibold text-[var(--muted)] hover:text-[var(--text)] lg:hidden">
        <span aria-hidden="true">←</span> Explore
      </button>

      <div key={token.address} className="pf-crossfade">
        {/* Identity + live price */}
        <div className="flex items-start gap-3">
          <CoinImage src={token.imageUrl} symbol={token.symbol} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold leading-tight text-[var(--text)]">{token.name}</h2>
              <span className="shrink-0 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Base</span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span className="font-semibold">{token.symbol}</span>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={copyAddress} title={token.address} className="rounded font-mono text-[11px] text-[var(--muted-dim)] hover:text-[var(--text)]">
                {copied ? "Copied" : shortAddress(token.address)}
              </button>
            </p>
          </div>
          <StarButton on={watched} onToggle={() => watch.toggle(token)} label={token.symbol} />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="text-3xl font-semibold leading-none text-[var(--text)]">
            {token.priceUsd > 0 ? <LivePrice value={token.priceUsd} /> : "—"}
          </p>
          <div className="flex items-baseline gap-3 text-sm">
            <Change value={token.change24h} label="24h" digits={2} />
            {period !== "24h" && <Change value={periodChange} label={period} digits={2} />}
          </div>
        </div>

        {/* Chart */}
        <div className="mt-4">
          <div className="mb-2 flex justify-end gap-1" role="group" aria-label="Chart period">
            {CHART_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={period === option}
                onClick={() => setPeriod(option)}
                className={`min-h-8 rounded-md px-2.5 text-xs font-semibold uppercase transition-colors ${
                  period === option ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          {history.status(token.address) === "none" ? (
            <div className="flex h-[320px] items-center justify-center rounded-lg bg-[var(--surface-raised)] text-xs text-[var(--muted-dim)]">
              No {period} price history for this coin yet
            </div>
          ) : (
            <div className="pf-coin-chart">
            <MarketChart
              points={chartPoints}
              now={now}
              label={`${token.symbol} ${period}`}
              tickSize={livePrice > 0 ? livePrice * 1e-4 : 1e-12}
              height={320}
              windowMs={chartWindow.ms}
              tickMs={chartWindow.tickMs}
              windowLabel={chartWindow.label}
              formatPrice={formatChartPrice}
              formatTime={formatChartTime(chartWindow.dates)}
              smooth={false}
            />
            </div>
          )}
        </div>

        {/* Context */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Stat label="Market cap" value={compactOrDash(token.marketCapUsd)} />
          <Stat label="Liquidity" value={compactOrDash(token.liquidityUsd)} />
          <Stat label="24h volume" value={compactOrDash(token.volume24hUsd)} />
          <Stat label="Pool age" value={token.pairCreatedAt ? ageLabel(token.pairCreatedAt, now) : "—"} />
        </dl>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{describe(token, now)}</p>
        <p className="mt-2 text-[11px] text-[var(--muted-dim)]">
          Price &amp; market data: DexScreener{quoteAge !== null && ` · updated ${quoteAge < 5 ? "just now" : `${quoteAge}s ago`}`} · Chart: GeckoTerminal
        </p>

        {holdings.length > 0 && (
          <p className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--selected-bg)] px-3 py-2 text-xs">
            <span className="text-[var(--text)]">
              You have {holdings.length} open position{holdings.length === 1 ? "" : "s"} in {token.symbol} ·{" "}
              <span className="font-semibold tabular-nums" style={{ color: pnlColor(holdingsPnl) }}>
                {signed(holdingsPnl)} Embers
              </span>
            </span>
            <button type="button" onClick={onViewPortfolio} className="shrink-0 font-semibold text-[var(--brand-strong)] lg:hidden">
              Manage
            </button>
          </p>
        )}
      </div>

      <div className="mt-4">
        <OrderForm
          token={token}
          availableCash={availableCash}
          sessionEnded={sessionEnded}
          busy={busy}
          error={error}
          onSubmit={onSubmit}
          onViewPortfolio={onViewPortfolio}
        />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-[var(--text)]">{value}</dd>
    </div>
  );
}
