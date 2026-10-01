"use client";

import { useState } from "react";
import type { ClosedPositionView } from "./types";
import { CoinImage, pct, pnlColor, signed } from "./ui";

const VISIBLE = 4;

/** This session's closed positions — compact, collapsed past the first few. */
export function ClosedPositions({ positions }: { positions: ClosedPositionView[] }) {
  const [expanded, setExpanded] = useState(false);
  if (positions.length === 0) return null;
  const shown = expanded ? positions : positions.slice(0, VISIBLE);

  return (
    <section className="rounded-xl bg-[var(--surface)] p-4" aria-label="Closed this session">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Closed this session</h2>
      <ul className="mt-2 divide-y divide-[color-mix(in_srgb,var(--line)_50%,transparent)]">
        {shown.map((position) => {
          const pnl = position.realizedPnl ?? 0;
          const returnPct = position.committedCash > 0 ? (pnl / position.committedCash) * 100 : 0;
          return (
            <li key={position.id} className="flex items-center gap-2.5 py-2">
              <CoinImage src={position.imageUrl} symbol={position.tokenSymbol} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--text)]">{position.tokenSymbol}</span>
                <span className="block text-[11px] text-[var(--muted-dim)]">
                  {position.kind === "spot" ? "Spot" : `${position.side === "long" ? "Long" : "Short"} ${position.leverage}×`}
                  {position.closeReason === "session_end" && " · closed at session end"}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums" style={{ color: pnlColor(pnl) }}>
                {signed(pnl)}
                <span className="block text-[11px] font-normal">{pct(returnPct, 1)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {positions.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 min-h-11 w-full rounded-lg text-xs font-semibold text-[var(--brand-strong)] transition hover:bg-[var(--surface-hover)]"
        >
          {expanded ? "Show less" : `Show all ${positions.length}`}
        </button>
      )}
    </section>
  );
}
