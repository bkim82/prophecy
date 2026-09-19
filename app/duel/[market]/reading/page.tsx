"use client";

import Link from "next/link";
import { SignInButton, useUser } from "@clerk/nextjs";
import { use, useEffect, useRef, useState } from "react";
import PriceChart from "@/app/PriceChart";
import { usePriceFeed } from "@/app/usePriceFeed";
import {
  READING_LEVERAGE_OPTIONS,
  readingPnl,
  type ReadingSide,
} from "@/lib/readingRules";
import type { ReadingStats, ReadingView } from "@/lib/reading";
import { productForMarket } from "@/lib/spotPrice";

const POLL_MS = 3000;
const TICK_MS = 1000;
const WAGER_PRESETS = [10, 100, 1000];

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const signedEmbers = (n: number) => `${n >= 0 ? "+" : "-"}${num(Math.abs(n))} embers`;
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");
const sideColor = (side: ReadingSide) => (side === "long" ? "var(--chart-up)" : "var(--chart-down)");

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const formatResetLabel = (atMs: number) =>
  new Date(atMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

type StateResponse = {
  serverNow: number;
  windowStartAt: number;
  windowEndAt: number;
  current: ReadingView | null;
  stats: ReadingStats;
};

const EMPTY_STATS: ReadingStats = { cumulativePnl: 0, dayPnl: 0, wins: 0, losses: 0, accuracy: 0 };

export default function Page({ params }: { params: Promise<{ market: string }> }) {
  const { market } = use(params);
  return <ReadingRoom market={market} />;
}

export function ReadingRoom({ market }: { market: string }) {
  const product = productForMarket(market);
  const { price, points, status, now } = usePriceFeed(product ?? "BTC-USD");
  const { isSignedIn, isLoaded } = useUser();

  const [state, setState] = useState<StateResponse | null>(null);
  const [wager, setWager] = useState(10);
  const [leverage, setLeverage] = useState<number>(READING_LEVERAGE_OPTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const skewRef = useRef(0);
  const wasOpenRef = useRef(false);
  const tzOffsetRef = useRef(0);

  useEffect(() => {
    tzOffsetRef.current = new Date().getTimezoneOffset();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!product || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const query = new URLSearchParams({ market, tzOffsetMinutes: String(tzOffsetRef.current) });
        const res = await fetch(`/api/reading?${query}`, { cache: "no-store" });
        if (!cancelled && res.ok) {
          const next = (await res.json()) as StateResponse;
          skewRef.current = next.serverNow - Date.now();
          if (wasOpenRef.current && next.current?.status === "settled") {
            window.dispatchEvent(new Event("balance-updated"));
          }
          wasOpenRef.current = next.current?.status === "open";
          setState(next);
        }
      } catch {
        // Keep the last state rather than blanking the panel on a blip.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [market, product, isLoaded, isSignedIn]);

  const placeCall = async (side: ReadingSide) => {
    if (busy || !product || state?.current) return;
    if (!Number.isInteger(wager) || wager <= 0) {
      setError("Enter a wager.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, side, wager, leverage, tzOffsetMinutes: tzOffsetRef.current }),
      });
      const data = (await res.json().catch(() => ({}))) as { reading?: ReadingView; error?: string };
      if (!res.ok || !data.reading) {
        setError(
          res.status === 402
            ? "Not enough embers for that wager."
            : res.status === 409
              ? "You already called this window."
              : (data.error ?? "Could not place that call."),
        );
        return;
      }
      wasOpenRef.current = true;
      setState((prev) => (prev ? { ...prev, current: data.reading! } : prev));
      window.dispatchEvent(new Event("balance-updated"));
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!product) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <h1 className="text-lg font-medium text-[var(--text)]">24h Reading isn&apos;t open for {market.toUpperCase()} yet</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Try BTC or ETH.</p>
        <Link href="/duel" className="mt-6 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]">
          Back to lobby
        </Link>
      </div>
    );
  }

  if (isLoaded && !isSignedIn) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center">
        <h1 className="text-lg font-medium text-[var(--text)]">Sign in to place a 24h Reading</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Your calls, wagers and stats are tied to your account.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <SignInButton mode="modal">
            <button className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]">
              Sign in
            </button>
          </SignInButton>
          <Link href="/duel" className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]">
            Back to lobby
          </Link>
        </div>
      </div>
    );
  }

  const current = state?.current ?? null;
  const stats = state?.stats ?? EMPTY_STATS;
  const localWindowEnd = state ? state.windowEndAt - skewRef.current : null;
  const countdownMs = localWindowEnd === null ? 0 : localWindowEnd - nowTick;
  const livePreviewPnl =
    current && current.status === "open" && price !== null ? readingPnl(current, price) : null;
  const headlinePrice = current?.status === "settled" ? (current.exitPrice ?? price) : price;
  const record = stats.wins + stats.losses === 0 ? "No calls settled yet" : `${stats.wins}W – ${stats.losses}L · ${stats.accuracy}%`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/duel" className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]">
        ← Menu
      </Link>
      <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        {market.toUpperCase()} · 24h Reading
      </h1>

      <section className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{market.toUpperCase()} / USD</p>
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-[var(--brand)]" : "bg-[var(--muted-dim)]"}`} />
            {status === "live" ? "live" : status}
          </span>
        </div>
        <p className="mt-1 text-5xl font-semibold tabular-nums text-[var(--text)]">
          {headlinePrice === null ? "Loading…" : usd(headlinePrice)}
        </p>
        <p className="mt-2 text-xs uppercase tracking-wider text-[var(--muted)]">
          {state ? `Window resets ${formatResetLabel(state.windowEndAt)} · ${formatCountdown(countdownMs)} left` : "Loading window…"}
        </p>
      </section>

      <section className="mt-4">
        <PriceChart points={points} now={now} />
      </section>

      <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">This window&apos;s call</p>
            <h2 className="mt-1 font-medium text-[var(--text)]">
              {current ? (current.status === "open" ? "Call locked in" : "Window settled") : "Choose your move"}
            </h2>
          </div>
          {current && (
            <span
              className="rounded-md border px-2.5 py-1 text-xs uppercase tracking-wider"
              style={{ borderColor: sideColor(current.side), color: sideColor(current.side) }}
            >
              {current.side} · {current.leverage}×
            </span>
          )}
        </div>

        {!current && (
          <div className="pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[var(--muted)]">Wager</span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">{num(wager)} embers</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {WAGER_PRESETS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setWager(option)}
                      className={`rounded-md border py-1.5 text-xs font-medium tabular-nums transition ${
                        wager === option
                          ? "border-[var(--brand)] bg-[var(--selected-bg)] text-[var(--brand-strong)]"
                          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      {num(option)}
                    </button>
                  ))}
                </div>
                <input
                  value={wager}
                  onChange={(event) => setWager(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                  inputMode="numeric"
                  aria-label="Custom wager amount"
                  className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm tabular-nums text-[var(--text)]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[var(--muted)]">Leverage</span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">{leverage}×</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {READING_LEVERAGE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setLeverage(option)}
                      className={`rounded-md border py-1.5 text-xs font-medium tabular-nums transition ${
                        leverage === option
                          ? "border-[var(--brand)] bg-[var(--selected-bg)] text-[var(--brand-strong)]"
                          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      {option}×
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {(["long", "short"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy || price === null}
                  onClick={() => void placeCall(option)}
                  style={price !== null ? { backgroundColor: sideColor(option), color: "var(--trade-contrast)" } : undefined}
                  className="rounded-lg px-3 py-2.5 text-left transition disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
                >
                  <span className="block text-xl font-semibold">{option === "long" ? "Long ↗" : "Short ↘"}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-sm text-[var(--muted)]">
              Locks in at the live price for the rest of this window — no closing early. One call per window.
            </p>
            {error && <p className="mt-2 text-center text-xs text-[var(--negative)]">{error}</p>}
          </div>
        )}

        {current && (
          <div className="pt-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Wager" value={`${num(current.wager)} embers`} />
              <Metric label="Entry" value={usd(current.entryPrice)} />
              {current.status === "open" ? (
                <Metric
                  label="Unrealized"
                  value={livePreviewPnl === null ? "—" : signedEmbers(livePreviewPnl)}
                  color={livePreviewPnl === null ? undefined : pnlColor(livePreviewPnl)}
                />
              ) : (
                <Metric label="Exit" value={current.exitPrice === null ? "—" : usd(current.exitPrice)} />
              )}
              <Metric
                label={current.status === "open" ? "Resets in" : "P&L"}
                value={current.status === "open" ? formatCountdown(countdownMs) : current.pnl === null ? "—" : signedEmbers(current.pnl)}
                color={current.status === "settled" && current.pnl !== null ? pnlColor(current.pnl) : undefined}
              />
            </div>
            <p className="mt-3 text-center text-sm text-[var(--muted)]">
              {current.status === "open"
                ? "This call is locked until the window closes — it settles automatically."
                : "Settled. A new call opens the moment the next window starts."}
            </p>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Stats · {market.toUpperCase()}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Cumulative P&L" value={signedEmbers(stats.cumulativePnl)} color={pnlColor(stats.cumulativePnl)} />
          <StatTile label="Today's P&L" value={signedEmbers(stats.dayPnl)} color={pnlColor(stats.dayPnl)} />
          <StatTile label="Record" value={record} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2.5">
      <p className="truncate text-xs uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3 text-center">
      <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums" style={color ? { color } : { color: "var(--text)" }}>
        {value}
      </p>
    </div>
  );
}
