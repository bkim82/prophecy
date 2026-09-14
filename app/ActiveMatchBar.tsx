"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPlayerId } from "./lib/playerId";
import { PulseMiniDock } from "./PulseMiniDock";
import {
  activeMatchHref,
  clearActiveMatch,
  getActiveMatch,
  isQueueing,
  subscribeActiveMatch,
  subscribeQueueing,
  type ActiveMatch,
} from "./lib/activeMatch";
import type { MatchView } from "@/lib/match";

const POLL_MS = 2000;

export function ActiveMatchBar() {
  const pathname = usePathname();
  const [match, setMatch] = useState<ActiveMatch | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [queueing, setQueueingState] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlayerId(getPlayerId());
  }, []);

  useEffect(() => {
    setMatch(getActiveMatch());
    return subscribeActiveMatch(() => setMatch(getActiveMatch()));
  }, []);

  useEffect(() => {
    setQueueingState(isQueueing());
    return subscribeQueueing(() => setQueueingState(isQueueing()));
  }, []);

  // Reset the stale view immediately on a match change so the bar never
  // flashes the previous duel's phase while the first poll is in flight.
  useEffect(() => setView(null), [match?.matchId]);

  const onOwnPage = Boolean(match) && pathname === activeMatchHref(match!);

  useEffect(() => {
    if (!match || onOwnPage) return;
    const playerId = getPlayerId();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/match/${encodeURIComponent(match.matchId)}?playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.status === 404) return clearActiveMatch(match.matchId);
        if (res.ok) {
          const next = (await res.json()) as MatchView;
          if (cancelled) return;
          if (next.status === "settled") return clearActiveMatch(match.matchId);
          setView(next);
        }
      } catch {
        // Transient failure: keep the bar showing rather than hide it.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [match, onOwnPage]);

  // A live Pulse round is the only phase you can act on mid-round (Quick Play
  // just locks one prediction before the round starts), so only it earns the
  // hover/tap trading dock.
  const dockEligible = match?.mode === "pulse" && view?.status === "countdown";

  useEffect(() => {
    if (!dockEligible) setDockOpen(false);
  }, [dockEligible]);

  useEffect(() => {
    if (!dockOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setDockOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dockOpen]);

  if (!match || onOwnPage || !view || queueing) return null;

  const marketLabel = match.market.toUpperCase();
  const modeLabel = match.mode === "pulse" ? "Pulse" : "Quick Play";
  const status = statusCopy(view);

  const handlePillClick = (event: React.MouseEvent) => {
    if (!dockEligible) return;
    event.preventDefault();
    setDockOpen((open) => !open);
  };

  return (
    <div
      ref={containerRef}
      className="active-match-bar"
      onMouseEnter={() => dockEligible && setDockOpen(true)}
      onMouseLeave={() => dockEligible && setDockOpen(false)}
    >
      <Link href={activeMatchHref(match)} className="active-match-bar-link" onClick={handlePillClick}>
        <span className="active-match-bar-dot" aria-hidden="true" />
        <span className="active-match-bar-copy">
          <strong>
            {marketLabel} {modeLabel} duel live
          </strong>
          <span className="muted">{status}</span>
        </span>
      </Link>
      {dockEligible && playerId && (
        <PulseMiniDock match={match} view={view} playerId={playerId} visible={dockOpen} onApply={setView} />
      )}
    </div>
  );
}

function statusCopy(view: MatchView): string {
  if (view.status === "open") return "Waiting for an opponent…";
  if (view.status === "predict") {
    return view.yourPrediction !== null
      ? "Waiting on your opponent to lock in"
      : "Lock a prediction before time runs out";
  }
  if (view.status === "countdown") return "Round in progress";
  return "Duel in progress";
}
