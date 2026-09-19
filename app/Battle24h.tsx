"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { usePriceFeed } from "./usePriceFeed";
import { readingPnl } from "@/lib/readingRules";
import type { ReadingCalendarDay, ReadingStats, ReadingView } from "@/lib/reading";

type Side = "long" | "short";
type DayResult = "win" | "loss" | "pending" | "none";
type ReadingState = {
  current: ReadingView | null;
  lastSettled: ReadingView | null;
  windowEndAt: number;
  stats: ReadingStats;
  calendar: ReadingCalendarDay[];
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const pad = (n: number) => String(n).padStart(2, "0");
const formatHms = (ms: number) => {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
const formatClockTime = (atMs: number) => new Date(atMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const longestRun = (results: DayResult[]) => {
  let best = 0;
  let run = 0;
  for (const result of results) { run = result === "win" ? run + 1 : 0; best = Math.max(best, run); }
  return best;
};

function useCountdownToUtcMidnight() {
  const [msLeft, setMsLeft] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setMsLeft(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return msLeft;
}

export function Battle24h({ feedSymbol }: { feedSymbol: string }) {
  const { isSignedIn } = useUser();
  const { price, points } = usePriceFeed(feedSymbol);
  const currentPrice = price ?? points.at(-1)?.p ?? null;
  const msLeft = useCountdownToUtcMidnight();
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const windowMsLeft = reading ? Math.max(0, reading.windowEndAt - Date.now()) : msLeft;
  const current = reading?.current ?? null;
  const hasCurrent = current !== null;
  const locked = windowMsLeft <= 0 || hasCurrent;
  const [pick, setPick] = useState<Side | null>(null);
  const [pickEntryPrice, setPickEntryPrice] = useState<number | null>(null);
  const [votes, setVotes] = useState({ long: 3102, short: 1046 });
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const query = new URLSearchParams({ market: feedSymbol.startsWith("ETH") ? "eth" : "btc", tzOffsetMinutes: String(new Date().getTimezoneOffset()) });
        const res = await fetch(`/api/reading?${query}`, { cache: "no-store" });
        if (res.ok && !cancelled) setReading((await res.json()) as ReadingState);
      } catch {
        // Keep the current calendar and call visible through transient errors.
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [feedSymbol, isSignedIn]);
  useEffect(() => {
    if (!reading?.current) return;
    setPick(reading.current.side);
    setPickEntryPrice(reading.current.entryPrice);
  }, [reading?.current?.side, reading?.current?.entryPrice]);
  const now = new Date();
  const today = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getUTCDay();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const calendarByDay = useMemo(() => new Map((reading?.calendar ?? []).map((d) => [d.day, d])), [reading?.calendar]);
  const calendar = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const entry = calendarByDay.get(day);
    const result: DayResult = day === today ? "pending" : day > today ? "none" : entry ? (entry.pnl > 0 ? "win" : "loss") : "none";
    return { day, result, pnl: entry?.pnl ?? null };
  }), [daysInMonth, today, calendarByDay]);
  const settledSoFar = calendar.filter((d) => d.result === "win" || d.result === "loss").map((d) => d.result);
  const currentStreak = (() => { let streak = 0; for (let i = settledSoFar.length - 1; i >= 0; i -= 1) { if (settledSoFar[i] !== "win") break; streak += 1; } return streak; })();
  const bestStreak = Math.max(currentStreak, longestRun(settledSoFar));
  const accuracy = reading?.stats.accuracy ?? 0;
  const totalVotes = votes.long + votes.short;
  const longPct = totalVotes === 0 ? 50 : Math.round((votes.long / totalVotes) * 100);
  const shortPct = 100 - longPct;
  const elapsedMs = current ? Math.max(0, Date.now() - current.placedAt) : 0;
  const livePnl = current && currentPrice !== null ? readingPnl(current, currentPrice) : null;
  const makePick = async (side: Side) => {
    if (locked || busy || !isSignedIn || currentPrice === null) return;
    setBusy(true);
    setError(null);
    try {
      const market = feedSymbol.startsWith("ETH") ? "eth" : "btc";
      const res = await fetch("/api/reading", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, side, wager: 10, leverage: 1, tzOffsetMinutes: new Date().getTimezoneOffset() }) });
      const data = (await res.json().catch(() => ({}))) as { reading?: ReadingView; error?: string };
      if (!res.ok || !data.reading) throw new Error(data.error ?? "Could not place that call");
      setReading((previous) => ({ current: data.reading!, lastSettled: previous?.lastSettled ?? null, windowEndAt: previous?.windowEndAt ?? Date.now(), stats: previous?.stats ?? { cumulativePnl: 0, dayPnl: 0, wins: 0, losses: 0, accuracy: 0 }, calendar: previous?.calendar ?? [] }));
      setVotes((v) => ({ ...v, [side]: v[side] + 1 }));
      setPick(side);
      setPickEntryPrice(data.reading.entryPrice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not place that call");
    } finally {
      setBusy(false);
    }
  };

  return <div className="battle-shell" data-market="btc">
      <section className="battle-hero panel"><div className="battle-choices">
      {(["long", "short"] as const).map((side) => <button key={side} type="button" className={`battle-choice is-${side} ${pick === side ? "is-selected" : ""}`} onClick={() => makePick(side)} disabled={locked || pick === side} aria-pressed={pick === side}>
        <span className="battle-choice-arrow" aria-hidden="true">{side === "long" ? "↑" : "↓"}</span><span className="battle-choice-label">{side === "long" ? "Long" : "Short"}</span>{pick === side && <span className="battle-choice-meta">✓ Called at {usd(pickEntryPrice ?? 0)}</span>}
      </button>)}
    </div>{pick !== null && !locked && <p className="battle-choices-hint">Tap the other side to change your call before lock.</p>}</section>
    {error && <p className="battle-choices-hint">{error}</p>}
    {reading?.lastSettled && <p className={`battle-result ${reading.lastSettled.pnl !== null && reading.lastSettled.pnl > 0 ? "is-win" : "is-loss"}`}>
      {reading.lastSettled.pnl !== null && reading.lastSettled.pnl > 0 ? "✓" : "✕"} {reading.lastSettled.side === "long" ? "Long" : "Short"} {reading.lastSettled.pnl !== null && reading.lastSettled.pnl > 0 ? "won" : "lost"} · {reading.lastSettled.pnl !== null && reading.lastSettled.pnl >= 0 ? "+" : ""}{reading.lastSettled.pnl ?? 0} embers
    </p>}
    <section className="battle-split"><div className="battle-split-labels"><span className="change-up">↑ Long {longPct}%</span><span className="change-down">Short {shortPct}% ↓</span></div><div className="battle-split-bar" role="img" aria-label={`${longPct}% long, ${shortPct}% short`}><div style={{ width: `${longPct}%`, background: "var(--chart-up)" }} /><div style={{ width: `${shortPct}%`, background: "var(--chart-down)" }} /></div><div className="battle-split-meta"><strong>{totalVotes.toLocaleString("en-US")}</strong> calls today <i>·</i> <strong>{currentStreak > 0 ? `🔥${currentStreak}` : currentStreak}</strong> streak <i>·</i> <strong>{bestStreak}</strong> best</div></section>
    <section className="battle-columns"><div className="battle-calendar"><div className="battle-calendar-head"><span className="eyebrow">{monthLabel}</span><div className="battle-calendar-legend"><span><i />Hit</span><span><i className="is-loss" />Miss</span></div></div><div className="battle-calendar-grid">{["S", "M", "T", "W", "T", "F", "S"].map((label, i) => <span key={i} className="battle-calendar-dow">{label}</span>)}{Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}{calendar.map(({ day, result, pnl }) => <div key={day} className={`battle-day ${result === "win" ? "is-win" : result === "loss" ? "is-loss" : result === "pending" ? "is-today" : ""}`} title={pnl !== null ? `${pnl >= 0 ? "+" : ""}${num(pnl)} embers` : undefined} aria-label={`Day ${day}${result === "win" ? `, correct, ${pnl !== null && pnl >= 0 ? "+" : ""}${pnl !== null ? num(pnl) : ""} embers` : result === "loss" ? `, missed, ${pnl !== null ? num(pnl) : ""} embers` : result === "pending" ? ", today" : ""}`}>{result === "win" ? "✓" : result === "loss" ? "✕" : day}</div>)}</div><div className="battle-calendar-accuracy"><strong>{accuracy}%</strong><span>Accuracy</span></div></div>
      <div className="battle-record"><div className="battle-countdown battle-record-countdown"><span>{current ? "In trade" : locked ? "Locked" : "Locks in"}</span><strong className={current ? "" : locked ? "is-locked" : ""}>{current ? formatHms(elapsedMs) : formatHms(windowMsLeft)}</strong><span>{reading ? `Settles ${formatClockTime(reading.windowEndAt)}` : "Settles —"}</span></div><span className="eyebrow">Your Battle Record</span><div className="battle-record-grid"><div className="battle-record-item"><strong>{current ? num(current.wager) : "—"}</strong><span>Wager</span></div><div className="battle-record-item"><strong>{current ? `${current.leverage}×` : "—"}</strong><span>Leverage</span></div><div className="battle-record-item"><strong>{current ? usd(current.entryPrice) : "—"}</strong><span>Entry price</span></div><div className="battle-record-item"><strong className={livePnl === null ? "" : livePnl >= 0 ? "change-up" : "change-down"}>{livePnl === null ? "—" : `${livePnl >= 0 ? "+" : ""}${num(livePnl)}`}</strong><span>P&L</span></div></div></div>
    </section>
  </div>;
}
