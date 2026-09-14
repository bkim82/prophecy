"use client";

import { useEffect, useMemo, useState } from "react";
import { usePriceFeed } from "./usePriceFeed";

type Side = "long" | "short";
type DayResult = "win" | "loss" | "pending" | "none";

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const pad = (n: number) => String(n).padStart(2, "0");

// Mock win/loss record — 24hr Battle has no schema or settlement job yet
// (docs/roadmap.md), so the calendar/streaks below are placeholder data, not a
// real per-player history. Day boundary is UTC midnight throughout.
const MOCK_PATTERN: DayResult[] = [
  "win", "win", "loss", "win", "win", "win", "loss",
  "loss", "win", "win", "win", "loss", "win", "win",
  "win", "win", "loss", "win", "win", "loss", "win",
  "win", "win", "loss", "win", "win", "win", "win",
];

const longestRun = (results: DayResult[]) => {
  let best = 0;
  let run = 0;
  for (const result of results) {
    run = result === "win" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
};

function useCountdownToUtcMidnight() {
  const [msLeft, setMsLeft] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      setMsLeft(nextMidnight - now.getTime());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return msLeft;
}

// The full 24hr Battle experience — prediction card, vote split, streaks,
// calendar — dropped straight into wherever it's used (the lobby's mode
// panel, or the standalone /duel/btc/battle deep link) rather than gated
// behind a separate "Play" step.
export function Battle24h({ feedSymbol }: { feedSymbol: string }) {
  const { price, points } = usePriceFeed(feedSymbol);
  const currentPrice = price ?? points.at(-1)?.p ?? null;
  const msLeft = useCountdownToUtcMidnight();
  const locked = msLeft <= 0;

  const [pick, setPick] = useState<Side | null>(null);
  const [pickEntryPrice, setPickEntryPrice] = useState<number | null>(null);
  // Seeded so the split starts close to the "75% long / 25% short" example —
  // the player's own vote is folded in live below, not persisted anywhere.
  const [votes, setVotes] = useState({ long: 3102, short: 1046 });

  const now = new Date();
  const today = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const leadingBlanks = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getUTCDay();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const calendar = useMemo(() => {
    const days: { day: number; result: DayResult }[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const result: DayResult =
        day === today ? "pending" : day > today ? "none" : MOCK_PATTERN[(day - 1) % MOCK_PATTERN.length];
      days.push({ day, result });
    }
    return days;
  }, [daysInMonth, today]);

  const settledSoFar = calendar.filter((d) => d.result !== "none" && d.result !== "pending").map((d) => d.result);
  const currentStreak = (() => {
    let streak = 0;
    for (let i = settledSoFar.length - 1; i >= 0; i -= 1) {
      if (settledSoFar[i] !== "win") break;
      streak += 1;
    }
    return streak;
  })();
  const bestStreak = Math.max(currentStreak, longestRun(settledSoFar));
  const wins = settledSoFar.filter((r) => r === "win").length;
  const losses = settledSoFar.filter((r) => r === "loss").length;
  const accuracy = settledSoFar.length === 0 ? 0 : Math.round((wins / settledSoFar.length) * 100);

  const totalVotes = votes.long + votes.short;
  const longPct = totalVotes === 0 ? 50 : Math.round((votes.long / totalVotes) * 100);
  const shortPct = 100 - longPct;

  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  const seconds = Math.floor((msLeft % 60_000) / 1000);

  const makePick = (side: Side) => {
    if (locked) return;
    if (pick === null) {
      setVotes((v) => ({ ...v, [side]: v[side] + 1 }));
    } else if (pick !== side) {
      setVotes((v) => ({ ...v, [pick]: v[pick] - 1, [side]: v[side] + 1 }));
    }
    setPick(side);
    setPickEntryPrice(currentPrice);
  };

  return (
    <div className="battle-shell" data-market="btc">
      {/* Make your call — the one bordered, elevated panel: countdown and choices */}
      <section className="battle-hero panel">
        <div className="battle-choices">
          <button
            type="button"
            className={`battle-choice is-long ${pick === "long" ? "is-selected" : ""}`}
            onClick={() => makePick("long")}
            disabled={locked || pick === "long"}
            aria-pressed={pick === "long"}
          >
            <span className="battle-choice-arrow" aria-hidden="true">↑</span>
            <span className="battle-choice-label">Long</span>
            {pick === "long" && <span className="battle-choice-meta">✓ Called at {usd(pickEntryPrice ?? 0)}</span>}
          </button>
          <button
            type="button"
            className={`battle-choice is-short ${pick === "short" ? "is-selected" : ""}`}
            onClick={() => makePick("short")}
            disabled={locked || pick === "short"}
            aria-pressed={pick === "short"}
          >
            <span className="battle-choice-arrow" aria-hidden="true">↓</span>
            <span className="battle-choice-label">Short</span>
            {pick === "short" && <span className="battle-choice-meta">✓ Called at {usd(pickEntryPrice ?? 0)}</span>}
          </button>
        </div>
        {pick !== null && !locked && (
          <p className="battle-choices-hint">Tap the other side to change your call before lock.</p>
        )}
      </section>

      {/* Community positioning, visually attached to the call above it */}
      <section className="battle-split">
        <div className="battle-split-labels">
          <span className="change-up">↑ Long {longPct}%</span>
          <span className="change-down">Short {shortPct}% ↓</span>
        </div>
        <div className="battle-split-bar" role="img" aria-label={`${longPct}% long, ${shortPct}% short`}>
          <div style={{ width: `${longPct}%`, background: "var(--chart-up)" }} />
          <div style={{ width: `${shortPct}%`, background: "var(--chart-down)" }} />
        </div>
        <div className="battle-split-meta">
          <strong>{totalVotes.toLocaleString("en-US")}</strong> calls today
          <i>·</i>
          <strong>{currentStreak > 0 ? `🔥${currentStreak}` : currentStreak}</strong> streak
          <i>·</i>
          <strong>{bestStreak}</strong> best
        </div>
      </section>

      {/* History calendar + battle record, side by side */}
      <section className="battle-columns">
        <div className="battle-calendar">
          <div className="battle-calendar-head">
            <span className="eyebrow">{monthLabel}</span>
            <div className="battle-calendar-legend">
              <span><i />Hit</span>
              <span><i className="is-loss" />Miss</span>
            </div>
          </div>
          <div className="battle-calendar-grid">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, i) => (
              <span key={i} className="battle-calendar-dow">{label}</span>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {calendar.map(({ day, result }) => (
              <div
                key={day}
                className={`battle-day ${
                  result === "win" ? "is-win" : result === "loss" ? "is-loss" : result === "pending" ? "is-today" : ""
                }`}
                aria-label={`Day ${day}${
                  result === "win" ? ", correct" : result === "loss" ? ", missed" : result === "pending" ? ", today" : ""
                }`}
              >
                {result === "win" ? "✓" : result === "loss" ? "✕" : day}
              </div>
            ))}
          </div>
        </div>

        <div className="battle-record">
          <div className="battle-countdown battle-record-countdown">
            <span>{locked ? "Settling" : "Locks in"}</span>
            <strong className={locked ? "is-locked" : ""}>
              {locked ? "00:00:00" : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
            </strong>
            <span>Settles 11:59 PM UTC</span>
          </div>
          <span className="eyebrow">Your Battle Record</span>
          <div className="battle-record-grid">
            <div className="battle-record-item">
              <strong>{currentStreak}</strong>
              <span>Current streak</span>
            </div>
            <div className="battle-record-item">
              <strong>{bestStreak}</strong>
              <span>Best streak</span>
            </div>
            <div className="battle-record-item">
              <strong className="change-up">{wins}</strong>
              <span>Wins</span>
            </div>
            <div className="battle-record-item">
              <strong className="change-down">{losses}</strong>
              <span>Losses</span>
            </div>
          </div>
          <div className="battle-record-accuracy">
            <strong>{accuracy}%</strong>
            <span>Accuracy</span>
          </div>
        </div>
      </section>
    </div>
  );
}
