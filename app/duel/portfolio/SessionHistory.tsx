"use client";

import { useState } from "react";
import type { SessionHistoryEntry } from "./types";
import { num, pct, pnlColor, signed } from "./ui";

const VISIBLE = 3;

const dateLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const dateTimeLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** Settled sessions: latest three, expandable to the full recent list, each row expandable for details. */
export function SessionHistory({ history }: { history: SessionHistoryEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (history.length === 0) return null;
  const shown = showAll ? history : history.slice(0, VISIBLE);

  return (
    <section aria-label="Past sessions">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Past sessions</h2>
      <ul className="mt-2 overflow-hidden rounded-xl bg-[var(--surface)]">
        {shown.map((entry, i) => {
          const finalEquity = entry.startingBalance + entry.realizedPnl;
          const returnPct = entry.startingBalance > 0 ? (entry.realizedPnl / entry.startingBalance) * 100 : 0;
          const isOpen = openId === entry.id;
          return (
            <li key={entry.id} className={i > 0 ? "border-t border-[color-mix(in_srgb,var(--line)_50%,transparent)]" : ""}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : entry.id)}
                className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand)] sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto]"
              >
                <span className="min-w-0">
                  <span className="block text-xs text-[var(--muted)]">{dateLabel(entry.settledAt)}</span>
                  <span className="block text-xs tabular-nums text-[var(--text)] sm:hidden">{num(finalEquity)} final</span>
                </span>
                <span className="hidden text-sm tabular-nums text-[var(--text)] sm:block">
                  {num(finalEquity)} <span className="text-xs text-[var(--muted)]">final</span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums" style={{ color: pnlColor(entry.realizedPnl) }}>
                  {signed(entry.realizedPnl)} Embers · {pct(returnPct, 1)}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  className={`h-4 w-4 text-[var(--muted)] transition-transform ${isOpen ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 3.5 4.5 4.5L6 12.5" />
                </svg>
              </button>
              {isOpen && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-3 text-xs sm:grid-cols-4">
                  <Detail label="Started" value={dateTimeLabel(entry.startAt)} />
                  <Detail label="Settled" value={dateTimeLabel(entry.settledAt)} />
                  <Detail label="Starting stake" value={`${num(entry.startingBalance)} Embers`} />
                  <Detail label="Final equity" value={`${num(Math.max(0, finalEquity))} Embers`} />
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {history.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-2 min-h-11 rounded-lg px-2 text-xs font-semibold text-[var(--brand-strong)] transition hover:bg-[var(--surface-hover)]"
        >
          {showAll ? "Show latest only" : "View session history"}
        </button>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-[var(--text)]">{value}</dd>
    </div>
  );
}
