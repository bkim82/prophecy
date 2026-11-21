"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { SignInAction } from "@/app/auth/AuthProvider";
import { FlameIcon } from "@/app/icons";
import type { FeaturedMatch, LobbyWin, TopCaller } from "@/app/lib/arenaLobby";
import { hueFromHandle } from "@/app/lib/avatar";
import { playedLabel } from "@/app/lib/playedLabel";

// Presentational pieces of the Arena page (app/duel/page.tsx). Every number
// here comes in as a prop from real data; a piece with nothing to show renders
// nothing (or a skeleton while loading). Styles: .arena-* in globals.css.

/** "12s ago" under a minute, then playedLabel's "16m ago" / "3h ago". */
export function agoLabel(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60 ? `${seconds}s ago` : playedLabel(at, now);
}

export const signedDollars = (value: number) =>
  `${value >= 0 ? "+" : "−"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const handlePath = (handle: string) => `/profile/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** Initial on a hue picked from the name — no image uploads needed. */
export function Avatar({ name, size = 32, tone }: { name: string; size?: number; tone?: "up" | "down" }) {
  const hue = hueFromHandle(name);
  const initial = name.replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`arena-avatar${tone ? ` is-${tone}` : ""}`}
      style={{ "--size": `${size}px`, "--hue": hue } as CSSProperties}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span className={`arena-skel ${className}`} style={style} aria-hidden="true" />;
}

/** One row of recent public wins under the header. Hidden until there is one. */
export function WinsTicker({ wins, now }: { wins: LobbyWin[]; now: number }) {
  if (wins.length === 0) return null;
  return (
    <section className="arena-ticker" aria-label="Live wins">
      <span className="arena-ticker-label"><span className="arena-live-dot" aria-hidden="true" />Live wins</span>
      <ul className="arena-ticker-list">
        {wins.map((win) => (
          <li key={win.id}>
            <Link href={handlePath(win.handle)} className="arena-ticker-handle">{win.handle}</Link> won{" "}
            <span className="arena-ticker-amount"><FlameIcon className="arena-ember" />{win.amount}</span> on {win.market.toUpperCase()} {win.timerSeconds}s
            <span className="arena-ticker-ago"> · {agoLabel(win.endedAt, now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const countdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function SeatCall({ seat, align }: { seat: FeaturedMatch["seats"][number]; align: "start" | "end" }) {
  const tone = seat.pnl === null || seat.pnl === 0 ? undefined : seat.pnl > 0 ? "up" : "down";
  return (
    <div className={`arena-featured-seat is-${align}`}>
      {align === "start" && <Avatar name={seat.name} size={36} tone={tone} />}
      <div className="arena-featured-who">
        <strong>{seat.name}</strong>
        <span className={`arena-featured-call${tone ? ` is-${tone}` : ""}`}>
          <span>{seat.side ? (seat.side === "long" ? "Long" : "Short") : "Flat"}</span>
          {seat.pnl !== null && <span className="arena-featured-pnl">{signedDollars(seat.pnl)}</span>}
        </span>
      </div>
      {align === "end" && <Avatar name={seat.name} size={36} tone={tone} />}
    </div>
  );
}

/**
 * One live public round: both seats' current call and P&L, and its clock.
 * Counts down locally from the poll's `msLeft`; gone once it hits zero.
 * No "Watch" link: there is no spectator view yet (docs/roadmap.md).
 */
export function FeaturedMatchStrip({ match, receivedAt }: { match: FeaturedMatch | null; receivedAt: number }) {
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    if (!match) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [match]);
  if (!match) return null;
  // `now` can trail a fresh poll by up to a tick; never count that as time gained.
  const left = match.msLeft - Math.max(0, now - receivedAt);
  if (left <= 0) return null;
  const [first, second] = match.seats;
  return (
    <section className="arena-featured" aria-label={`Live match: ${first.name} versus ${second.name}, ${match.market.toUpperCase()} ${match.timerSeconds}s`}>
      <span className="arena-featured-label">Live match · {match.market.toUpperCase()}</span>
      <SeatCall seat={first} align="end" />
      <div className="arena-featured-vs">
        <span>VS</span>
        <time className="arena-mono" aria-label={`${Math.ceil(left / 1000)} seconds left`}>{countdown(left)}</time>
      </div>
      <SeatCall seat={second} align="start" />
    </section>
  );
}

/** Today's (rolling 24h) best callers by net Embers. Hidden until someone has played. */
export function TopCallers({ leaders }: { leaders: TopCaller[] | null }) {
  if (leaders !== null && leaders.length === 0) return null;
  return (
    <section className="arena-card arena-leaders" aria-labelledby="arena-leaders-title">
      <div className="arena-card-head">
        <h2 id="arena-leaders-title">Top callers today</h2>
        {/* TODO: link "Full leaderboard →" once a leaderboard page exists; the full board only lives in the feed rail (app/OraclesLeaderboard.tsx). */}
      </div>
      <ol className="arena-leader-list">
        {leaders === null
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="arena-leader-row is-loading">
                <Skeleton style={{ width: 18, height: 12 }} />
                <Skeleton className="is-round" style={{ width: 32, height: 32 }} />
                <Skeleton style={{ flex: 1, height: 12 }} />
                <Skeleton style={{ width: 60, height: 12 }} />
              </li>
            ))
          : leaders.map((leader, i) => (
              <li key={leader.handle} className="arena-leader-row" data-place={i + 1}>
                <span className="arena-leader-rank arena-mono">{String(i + 1).padStart(2, "0")}</span>
                <Avatar name={leader.handle} />
                <Link href={handlePath(leader.handle)} className="arena-leader-name">{leader.handle}</Link>
                <span className="arena-leader-record">{leader.won}W · {leader.lost}L</span>
                <span className={`arena-leader-pnl arena-mono ${leader.net >= 0 ? "is-up" : "is-down"}`}>
                  {leader.net >= 0 ? "+" : "−"}{Math.abs(leader.net).toLocaleString("en-US")}
                </span>
              </li>
            ))}
      </ol>
    </section>
  );
}

export type RecentResult = {
  id: string;
  market: string;
  result: "won" | "lost" | "tie";
  yourProfit: number | null;
  opponentName: string;
  playedAt: number;
};

const RESULT_LABEL: Record<RecentResult["result"], string> = { won: "Won", lost: "Lost", tie: "Tie" };

function ResultSkeletons() {
  return (
    <div className="arena-result-skeletons" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i}>
          <Skeleton className="is-round" style={{ width: 28, height: 28 }} />
          <Skeleton style={{ flex: 1, height: 12 }} />
          <Skeleton style={{ width: 54, height: 12 }} />
        </div>
      ))}
    </div>
  );
}

/** Your newest settled Pulse matches; signed out, a placeholder and a sign-in. */
export function RecentResults({ isSignedIn, results, now }: { isSignedIn: boolean | undefined; results: RecentResult[] | null; now: number }) {
  return (
    <section className="arena-card arena-results" aria-labelledby="arena-results-title">
      <div className="arena-card-head">
        <h2 id="arena-results-title">Your recent results</h2>
        <span className="arena-card-meta">Pulse matches</span>
      </div>
      {isSignedIn === false ? (
        <>
          <ResultSkeletons />
          <div className="arena-results-empty">
            <p>Your wins, losses and streaks show up here.</p>
            <SignInAction><button type="button" className="arena-ghost-button">Sign in to track results</button></SignInAction>
          </div>
        </>
      ) : results === null ? (
        <ResultSkeletons />
      ) : results.length === 0 ? (
        <div className="arena-results-empty">
          <p>No results yet. Finish a Pulse match and it shows up here.</p>
        </div>
      ) : (
        <ul className="arena-result-list">
          {results.map((result) => (
            <li key={result.id} className="arena-result-row">
              <Avatar name={result.opponentName} size={28} />
              <span className="arena-result-main">
                <strong>{result.market.toUpperCase()} <span className="arena-muted">vs {result.opponentName}</span></strong>
                <span className="arena-muted">{agoLabel(result.playedAt, now)}</span>
              </span>
              <span className={`arena-result-tag is-${result.result}`}>{RESULT_LABEL[result.result]}</span>
              <span className={`arena-result-pnl${result.yourProfit === null ? "" : result.yourProfit >= 0 ? " is-up" : " is-down"}`}>
                {result.yourProfit === null ? "—" : signedDollars(result.yourProfit)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
