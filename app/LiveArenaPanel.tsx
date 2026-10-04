"use client";

import { useEffect, useState } from "react";
import { ArenaSigilIcon } from "@/app/icons";
import { LIVE_ARENAS } from "@/app/lib/sidebarMocks";

// Duels with this many seconds or fewer left render red.
const ARENA_URGENT_SECONDS = 10;
// Mock duels never end: after 0:00 each one restarts as a fresh round this long.
const ARENA_ROUND_SECONDS = 90;

function secondsLeft(timer: string) {
  const [minutes, seconds] = timer.split(":").map(Number);
  return minutes * 60 + seconds;
}

// Counts down from the mock timer, holds 0:00 for one tick, then loops rounds.
function remainingAt(initial: number, elapsed: number) {
  const overrun = elapsed - initial;
  if (overrun <= 0) return -overrun;
  return ARENA_ROUND_SECONDS - ((overrun - 1) % (ARENA_ROUND_SECONDS + 1));
}

function formatTimer(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function LiveArenaPanel() {
  // Starts at 0 on the server and first client render so hydration matches;
  // derived from the wall clock so background-tab timer throttling can't drift it.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="panel sidebar-panel sidebar-panel--arena">
      <h3>
        <ArenaSigilIcon className="sidebar-arena-sigil" />
        Live in the Arena
        <span className="sidebar-live-dot" role="img" aria-label="Live" />
      </h3>
      {LIVE_ARENAS.map((arena) => {
        const remaining = remainingAt(secondsLeft(arena.timer), elapsed);
        const isUrgent = remaining <= ARENA_URGENT_SECONDS;
        return (
          <div className={`sidebar-row sidebar-row--arena${isUrgent ? " is-urgent" : ""}`} key={arena.id}>
            <div className="sidebar-row-main">
              <span className="sidebar-arena-rank" data-rank={arena.tier} role="img" aria-label={`${arena.tier} rank`} />
              <strong>{arena.players}</strong>
            </div>
            <span className="sidebar-value">{formatTimer(remaining)}</span>
          </div>
        );
      })}
    </section>
  );
}
