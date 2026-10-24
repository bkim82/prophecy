"use client";

import { useEffect, useState } from "react";
import { ArenaSigilIcon } from "@/app/icons";
import type { LiveArena } from "@/app/lib/sidebar";

// Rounds with this many seconds or fewer left render red.
const ARENA_URGENT_SECONDS = 10;

function formatTimer(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Pulse rounds being played right now (lib/sidebar.ts), each counting down
// from its time left when the page rendered; a round drops out when it ends,
// and the panel goes once none are left. New rounds show on the next load.
export function LiveArenaPanel({ arenas }: { arenas: LiveArena[] }) {
  // Starts at 0 on the server and first client render so hydration matches;
  // derived from the wall clock so background-tab timer throttling can't drift it.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (arenas.length === 0) return;
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [arenas]);

  const live = arenas.map((arena) => ({ arena, remaining: arena.secondsLeft - elapsed })).filter(({ remaining }) => remaining > 0);
  if (live.length === 0) return null;

  return (
    <section className="panel sidebar-panel sidebar-panel--arena">
      <h3>
        <ArenaSigilIcon className="sidebar-arena-sigil" />
        Live in the Arena
        <span className="sidebar-live-dot" role="img" aria-label="Live" />
      </h3>
      {live.map(({ arena, remaining }) => (
        <div className={`sidebar-row sidebar-row--arena${remaining <= ARENA_URGENT_SECONDS ? " is-urgent" : ""}`} key={arena.id}>
          <div className="sidebar-row-main">
            <span className="sidebar-arena-rank" data-rank={arena.tier} role="img" aria-label={`${arena.tier} rank`} />
            <strong>{arena.players}</strong>
          </div>
          <span className="sidebar-value">{formatTimer(remaining)}</span>
        </div>
      ))}
    </section>
  );
}
