"use client";

import { useId, useState, type CSSProperties } from "react";
import { TOP_TRADERS, type LeaderboardPeriod, type TopTrader } from "@/app/lib/sidebarMocks";

// "The Oracles": the Omens leaderboard as a tarot spread. Ranks I–III are
// cards on a podium, dealt face-down and flipped III → II → I; the rest is a
// ranked list. Rank only, no score. Switching period remounts the board
// (keyed by period) so the whole deal replays. Timing lives in globals.css
// (.oracles-*); see docs/feeds.md.

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
  { id: "all", label: "ALL" },
];
const PODIUM_COUNT = 3;
// Podium + ranks IV–V; "View full leaderboard" expands to the rest.
const PREVIEW_COUNT = 5;
// List rows wait for rank I to land, then cascade. Rows revealed by
// expanding skip the wait.
const LIST_ENTER_MS = 1450;
const ROW_STEP_MS = 90;
const AVATAR_TINTS = ["#b9a9f7", "#8fe3c2", "#ebc56a", "#94a9f3", "#f1a9c5"];

// Motes rising behind the podium; fixed values so server and client agree.
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  "--x": `${(i * 37 + 11) % 100}%`,
  "--size": `${1.5 + (i % 3) * 0.75}px`,
  "--drift": `${(i % 5) * 4 - 8}px`,
  "--dur": `${5 + (i % 4)}s`,
  "--delay": `${((i * 0.83) % 6).toFixed(2)}s`,
}));

const NUMERALS: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

function toRoman(n: number): string {
  let out = "";
  for (const [value, numeral] of NUMERALS) {
    for (; n >= value; n -= value) out += numeral;
  }
  return out;
}

function tintFor(handle: string): string {
  // A plain char-code sum spreads the current mock handles across all tints.
  let sum = 0;
  for (const char of handle) sum += char.charCodeAt(0);
  return AVATAR_TINTS[sum % AVATAR_TINTS.length];
}

// Initial on a tinted face; the ring around it is the win rate (green arc =
// wins), drawn in by CSS.
function OracleAvatar({ trader }: { trader: TopTrader }) {
  return (
    <span
      className="oracle-avatar"
      style={{ "--tint": tintFor(trader.handle), "--win": trader.winRate } as CSSProperties}
      aria-hidden="true"
    >
      {trader.handle.charAt(1).toUpperCase()}
    </span>
  );
}

export function OraclesLeaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("7d");
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const traders = TOP_TRADERS[period];
  const rest = traders.slice(PODIUM_COUNT, expanded ? undefined : PREVIEW_COUNT);
  const previewRows = PREVIEW_COUNT - PODIUM_COUNT;

  return (
    <section className="panel sidebar-panel oracles-panel" aria-labelledby={`${id}-title`}>
      <div className="oracles-head">
        <h3 className="oracles-title" id={`${id}-title`}>
          The Oracles
        </h3>
        <div className="oracles-periods" role="group" aria-label="Leaderboard period">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => {
                setPeriod(id);
                setExpanded(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="oracles-board" key={period}>
        <div className="oracles-stage">
          <div className="oracles-embers" aria-hidden="true">
            {EMBERS.map((ember, i) => (
              <span key={i} className="oracle-ember" style={ember as CSSProperties} />
            ))}
          </div>
          {/* DOM order is rank order; CSS `order` lays the podium out II · I · III. */}
          <ol className="oracles-podium">
            {traders.slice(0, PODIUM_COUNT).map((trader, i) => (
              <li
                key={trader.handle}
                className="oracle-card"
                data-place={i + 1}
                style={{ "--deal": PODIUM_COUNT - 1 - i } as CSSProperties}
              >
                <div className="oracle-card-flip">
                  <div className="oracle-card-face">
                    <span className="oracle-corners" aria-hidden="true" />
                    <span className="oracle-card-rank">
                      <small>Rank</small> {toRoman(i + 1)}
                    </span>
                    <span className="oracle-sigil">
                      <span className="oracle-rays" aria-hidden="true" />
                      <OracleAvatar trader={trader} />
                    </span>
                    <strong className="oracle-card-handle">{trader.handle}</strong>
                    <span className="oracle-card-tier">{trader.tier}</span>
                  </div>
                  <div className="oracle-card-back" aria-hidden="true" />
                </div>
              </li>
            ))}
          </ol>
        </div>

        <ol className="oracles-list" id={`${id}-list`} start={PODIUM_COUNT + 1}>
          {rest.map((trader, i) => {
            const enter = i < previewRows ? LIST_ENTER_MS + i * ROW_STEP_MS : (i - previewRows) * ROW_STEP_MS;
            return (
              <li key={trader.handle} className="oracle-row" style={{ "--enter": `${enter}ms` } as CSSProperties}>
                <span className="oracle-row-rank">
                  <small>Rank</small> {toRoman(PODIUM_COUNT + 1 + i)}
                </span>
                <OracleAvatar trader={trader} />
                <span className="oracle-row-who">
                  <strong className="oracle-row-handle">{trader.handle}</strong>
                  <span className="oracle-row-tier">{trader.tier}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {traders.length > PREVIEW_COUNT && (
        <button
          type="button"
          className="oracles-more"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "View full leaderboard"} <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}
