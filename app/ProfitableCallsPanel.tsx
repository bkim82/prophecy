"use client";

import { useState } from "react";
import { signedPct } from "@/app/lib/calls";
import type { CallWindow, ProfitableCall } from "@/app/lib/sidebar";
import { ARENA_GLYPHS } from "@/app/lib/trades";

const WINDOWS: { id: CallWindow; label: string; span: string }[] = [
  { id: "1h", label: "1H", span: "hour" },
  { id: "24h", label: "24H", span: "day" },
  { id: "7d", label: "7D", span: "week" },
];

// Arena markets get the lobby's glyph; Portfolio tokens their first letter.
function CallGlyph({ call }: { call: ProfitableCall }) {
  const arena = call.source === "arena" ? ARENA_GLYPHS[call.symbol] : undefined;
  return arena ? (
    <span className={`market-symbol ${arena.className}`}>{arena.glyph}</span>
  ) : (
    <span className="market-symbol">{call.symbol.replace(/[^a-z0-9]/gi, "").charAt(0) || "?"}</span>
  );
}

// "BTC ↑ LONG" / "DEGEN SPOT" / "BTC PULSE".
function callLabel(call: ProfitableCall) {
  if (call.position === "long") return `${call.symbol} ↑ LONG`;
  if (call.position === "short") return `${call.symbol} ↓ SHORT`;
  return `${call.symbol} ${call.position === "spot" ? "SPOT" : "PULSE"}`;
}

// "Most Profitable Calls": the best closed trades per time window (lib/sidebar.ts
// — 24h Portfolio positions and Arena rounds that made money, by return).
// Nothing renders until there's at least one in the last week.
export function ProfitableCallsPanel({ calls }: { calls: Record<CallWindow, ProfitableCall[]> }) {
  // The day, unless it was quiet and the week has something to show.
  const [activeWindow, setActiveWindow] = useState<CallWindow>(calls["24h"].length > 0 ? "24h" : "7d");
  // The week covers the shorter windows, so an empty week means nothing to show.
  if (calls["7d"].length === 0) return null;
  const ranked = calls[activeWindow];
  const span = WINDOWS.find(({ id }) => id === activeWindow)?.span;

  return (
    <section className="panel sidebar-panel sidebar-panel--calls">
      <div className="sidebar-calls-head">
        <h3>Most Profitable Calls</h3>
        <div className="sidebar-window-tabs" role="tablist" aria-label="Time window">
          {WINDOWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeWindow === id}
              className={activeWindow === id ? "active" : undefined}
              onClick={() => setActiveWindow(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {ranked.length === 0 ? (
        <p className="muted sidebar-empty">No profitable trades in the last {span}.</p>
      ) : (
        <ol className="sidebar-calls-list">
          {ranked.map((call) => (
            <li className="sidebar-row sidebar-row--call" key={call.id}>
              <div className="sidebar-row-main">
                <CallGlyph call={call} />
                <div className="sidebar-call-text">
                  <strong>{callLabel(call)}</strong>
                  <span className="sidebar-call-detail">
                    {call.leverage ? `${call.leverage}× · ` : ""}
                    {call.handle}
                  </span>
                </div>
              </div>
              <span className="sidebar-value sidebar-call-roi is-up">{signedPct(call.roiPct)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
