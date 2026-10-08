"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PulseSide } from "@/lib/pulse";
import { ENTRY_INDEX, LEAD_IN_S, ROUND_S, sampleIndex, type LessonExit, type PathPoint } from "./lessons";

/**
 * Teaching chart for the scripted lessons. Unlike PriceChart it is not a
 * scrolling live window: the x-axis is the whole round (plus a short lead-in)
 * and the y-axis is fixed per lesson, so the line simply draws left to right.
 * Zones behind the line spell out what a price level means for your trade:
 * profit, loss, and — from lesson 4 — liquidation.
 */

type Props = {
  path: PathPoint[];
  /** Last sample drawn; ENTRY_INDEX while waiting for the player. */
  revealIndex: number;
  domain: { low: number; high: number };
  /** The side to shade zones for — previewed faintly before entering. */
  side: PulseSide | null;
  entered: boolean;
  liquidationPrice: number | null;
  exit: LessonExit | null;
  /** Debrief marker for the best moment to have closed. */
  peak?: { s: number; p: number; pnl: number } | null;
};

const W = 880;
const H = 560;
const PAD = { top: 22, right: 92, bottom: 34, left: 14 };
const COMPACT = { w: 520, h: 390, pad: { top: 26, right: 104, bottom: 44, left: 14 } };

const UP = "var(--chart-up)";
const DOWN = "var(--chart-down)";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const axisLabel = (n: number, span: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: span < 25 ? 2 : 0, maximumFractionDigits: span < 25 ? 2 : 0 });
const sideColor = (side: PulseSide) => (side === "long" ? UP : DOWN);

const linePath = (pts: { x: number; y: number }[]) =>
  pts.map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join("");

export default function LessonChart({ path, revealIndex, domain, side, entered, liquidationPrice, exit, peak }: Props) {
  const uid = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  // Same trick as PriceChart: a narrower, taller viewBox on phones so the SVG
  // text doesn't shrink to a few pixels.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setIsCompact(el.clientWidth <= 560);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = isCompact ? COMPACT.w : W;
  const height = isCompact ? COMPACT.h : H;
  const pad = isCompact ? COMPACT.pad : PAD;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const plotRight = pad.left + innerW;
  const baseline = pad.top + innerH;
  const fs = 14;
  const fsSmall = isCompact ? 12 : 12.5;

  const span = domain.high - domain.low;
  const x = (s: number) => pad.left + ((s + LEAD_IN_S) / (LEAD_IN_S + ROUND_S)) * innerW;
  const y = (p: number) => pad.top + ((domain.high - p) / span) * innerH;
  const clampY = (v: number) => Math.min(baseline, Math.max(pad.top, v));

  const entry = path[ENTRY_INDEX];
  const entryY = y(entry.p);
  const startX = x(0);
  const bellX = x(ROUND_S);
  const head = path[revealIndex];
  const headX = x(head.s);
  const headY = y(head.p);

  // Where the player's own line stops: at the exit, then a ghost carries on.
  const exitIndex = exit ? sampleIndex(exit.s) : null;
  const tradeEnd = exitIndex !== null ? Math.min(exitIndex, revealIndex) : revealIndex;
  const toXY = (pt: PathPoint) => ({ x: x(pt.s), y: y(pt.p) });
  const leadD = linePath(path.slice(0, ENTRY_INDEX + 1).map(toXY));
  const tradeD = entered && tradeEnd > ENTRY_INDEX ? linePath(path.slice(ENTRY_INDEX, tradeEnd + 1).map(toXY)) : "";
  const ghostD = exitIndex !== null && revealIndex > exitIndex ? linePath(path.slice(exitIndex, revealIndex + 1).map(toXY)) : "";

  // Zones: above the entry is profit for a long and loss for a short.
  const profitAbove = side === "long";
  const zoneOpacity = entered ? 1 : 0.55;
  const liqY = liquidationPrice !== null ? y(liquidationPrice) : null;
  const liqVisible = liqY !== null && liqY >= pad.top && liqY <= baseline;
  const liqZone =
    liqY === null || !side
      ? null
      : side === "long"
        ? { y0: clampY(liqY), y1: baseline }
        : { y0: pad.top, y1: clampY(liqY) };

  const gridValues = Array.from({ length: 5 }, (_, i) => domain.high - (span * i) / 4);
  const timeTicks = [0, 15, 30, 45, 60];

  const pillW = pad.right - 10;
  const pillX = width - pillW - 2;
  const headColor = !entered || !side ? "var(--chart-line)" : (head.p >= entry.p) === (side === "long") ? UP : DOWN;

  return (
    <div ref={containerRef} className="tut-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Lesson price chart">
        <defs>
          <clipPath id={`${uid}-above`}>
            <rect x={0} y={0} width={width} height={Math.max(0, entryY)} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <rect x={0} y={entryY} width={width} height={Math.max(0, height - entryY)} />
          </clipPath>
          <pattern id={`${uid}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--negative)" strokeWidth="2" strokeOpacity=".22" />
          </pattern>
          <linearGradient id={`${uid}-lead`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--brand)" stopOpacity=".07" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        {/* Profit / loss zones over the round, from the entry price outward */}
        {side && (
          <g opacity={zoneOpacity}>
            <rect
              x={startX}
              y={pad.top}
              width={bellX - startX}
              height={Math.max(0, clampY(entryY) - pad.top)}
              fill={profitAbove ? "var(--positive)" : "var(--negative)"}
              fillOpacity=".07"
            />
            <rect
              x={startX}
              y={clampY(entryY)}
              width={bellX - startX}
              height={Math.max(0, baseline - clampY(entryY))}
              fill={profitAbove ? "var(--negative)" : "var(--positive)"}
              fillOpacity=".06"
            />
            <text x={bellX - 8} y={pad.top + fs + 4} textAnchor="end" fontSize={fsSmall} fontWeight="700" letterSpacing=".12em" fill={profitAbove ? "var(--positive)" : "var(--negative)"} opacity=".8">
              {profitAbove ? "PROFIT ZONE" : "LOSS ZONE"}
            </text>
            <text x={bellX - 8} y={baseline - 8} textAnchor="end" fontSize={fsSmall} fontWeight="700" letterSpacing=".12em" fill={profitAbove ? "var(--negative)" : "var(--positive)"} opacity=".8">
              {profitAbove ? "LOSS ZONE" : "PROFIT ZONE"}
            </text>
          </g>
        )}

        {/* Liquidation: everything past this price wipes out the stake */}
        {liqZone && liqZone.y1 > liqZone.y0 && (
          <g opacity={zoneOpacity}>
            <rect x={startX} y={liqZone.y0} width={bellX - startX} height={liqZone.y1 - liqZone.y0} fill="var(--negative)" fillOpacity=".1" />
            <rect x={startX} y={liqZone.y0} width={bellX - startX} height={liqZone.y1 - liqZone.y0} fill={`url(#${uid}-hatch)`} />
          </g>
        )}
        {liqVisible && liqY !== null && liquidationPrice !== null && (
          <g>
            <line x1={startX} x2={bellX} y1={liqY} y2={liqY} stroke="var(--negative)" strokeWidth="1.5" strokeDasharray="6 4" />
            {/* Right end, on the safe side of the line: clear of the exit marker's label and the zone label at the edge. */}
            <text x={bellX - 8} y={side === "long" ? liqY - 6 : liqY + fs + 3} textAnchor="end" fontSize={fsSmall} fontWeight="700" fill="var(--negative)">
              LIQUIDATION {usd(liquidationPrice)}
            </text>
          </g>
        )}
        {liquidationPrice !== null && !liqVisible && (
          <text x={startX + 8} y={side === "long" ? baseline - 8 : pad.top + fs + 4} fontSize={fsSmall} fontWeight="600" fill="var(--muted)">
            {side === "long" ? "↓" : "↑"} Liquidation {usd(liquidationPrice)} — far off the chart
          </text>
        )}

        {/* Lead-in tint: the price before you were in */}
        <rect x={pad.left} y={pad.top} width={startX - pad.left} height={innerH} fill={`url(#${uid}-lead)`} />

        {/* Grid + price axis */}
        {gridValues.map((value, i) => (
          <g key={i}>
            <line x1={pad.left} x2={plotRight} y1={y(value)} y2={y(value)} className="market-chart-grid" />
            <text x={plotRight + 8} y={y(value) + 4} fontSize={fsSmall} fill="var(--muted-dim)" className="tabular-nums">
              {axisLabel(value, span)}
            </text>
          </g>
        ))}

        {/* Round clock along the bottom */}
        <line x1={startX} x2={startX} y1={pad.top} y2={baseline} stroke="var(--chart-accent)" strokeDasharray="3 3" opacity=".8" />
        <line x1={bellX} x2={bellX} y1={pad.top} y2={baseline} stroke="var(--line-strong)" strokeDasharray="3 3" />
        {timeTicks.map((t) => (
          <text key={t} x={x(t)} y={baseline + fs + 6} textAnchor="middle" fontSize={fsSmall} fill="var(--muted-dim)" className="tabular-nums">
            {t === 0 ? "start" : t === ROUND_S ? "bell" : `${t}s`}
          </text>
        ))}

        {/* Entry price, carried across the round */}
        {side && (
          <g opacity={entered ? 1 : 0.5}>
            <line x1={startX} x2={bellX} y1={entryY} y2={entryY} stroke={sideColor(side)} strokeWidth="1.25" strokeDasharray="4 3" opacity=".8" />
            <rect x={pad.left + 2} y={entryY - (isCompact ? 11 : 9)} width={isCompact ? 62 : 50} height={isCompact ? 22 : 18} rx="4" fill="var(--surface)" stroke={sideColor(side)} strokeOpacity=".7" />
            <text x={pad.left + (isCompact ? 33 : 27)} y={entryY + (isCompact ? 5 : 4)} textAnchor="middle" fontSize={fsSmall} fontWeight="700" fill={sideColor(side)}>
              ENTRY
            </text>
          </g>
        )}

        {/* The price line: lead-in, your trade (green in profit, red in loss), then what happened after you left */}
        <path d={leadD} fill="none" stroke="var(--chart-line)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" opacity={entered ? 0.55 : 1} />
        {tradeD && side && (
          <>
            <g clipPath={`url(#${uid}-above)`}>
              <path d={tradeD} fill="none" stroke={profitAbove ? UP : DOWN} strokeWidth="7" opacity=".35" filter={`url(#${uid}-glow)`} />
              <path d={tradeD} className="market-chart-line" stroke={profitAbove ? UP : DOWN} />
            </g>
            <g clipPath={`url(#${uid}-below)`}>
              <path d={tradeD} fill="none" stroke={profitAbove ? DOWN : UP} strokeWidth="7" opacity=".35" filter={`url(#${uid}-glow)`} />
              <path d={tradeD} className="market-chart-line" stroke={profitAbove ? DOWN : UP} />
            </g>
          </>
        )}
        {ghostD && (
          <path d={ghostD} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" opacity=".75" />
        )}

        {/* Markers */}
        {entered && side && (
          <circle cx={startX} cy={entryY} r="6" fill={sideColor(side)} stroke="var(--surface)" strokeWidth="2" style={{ filter: `drop-shadow(0 0 4px ${sideColor(side)})` }} />
        )}
        {peak && peak.pnl > 0 && (
          <g>
            <path
              d={`M${x(peak.s)},${y(peak.p) - 8}L${x(peak.s) + 8},${y(peak.p)}L${x(peak.s)},${y(peak.p) + 8}L${x(peak.s) - 8},${y(peak.p)}Z`}
              fill="var(--gold)"
              stroke="var(--surface)"
              strokeWidth="1.5"
            />
            {/* Below the diamond: the exit label (when you closed near the top) sits above it. */}
            <text x={x(peak.s)} y={y(peak.p) + fs + 12} textAnchor="middle" fontSize={fsSmall} fontWeight="700" fill="var(--gold)">
              Best moment {signedUsd(peak.pnl)}
            </text>
          </g>
        )}
        {exit && (exitIndex === null || exitIndex <= revealIndex) && (
          <g>
            {exit.kind === "liquidated" ? (
              <g stroke="var(--negative)" strokeWidth="3" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px var(--negative))" }}>
                <line x1={x(exit.s) - 7} y1={clampY(y(exit.p)) - 7} x2={x(exit.s) + 7} y2={clampY(y(exit.p)) + 7} />
                <line x1={x(exit.s) - 7} y1={clampY(y(exit.p)) + 7} x2={x(exit.s) + 7} y2={clampY(y(exit.p)) - 7} />
              </g>
            ) : (
              <rect x={x(exit.s) - 6} y={y(exit.p) - 6} width="12" height="12" rx="2" fill="var(--surface)" stroke={exit.pnl >= 0 ? UP : DOWN} strokeWidth="2.5" />
            )}
            <text
              x={Math.min(x(exit.s), bellX - 40)}
              y={clampY(y(exit.p)) + (exit.kind === "liquidated" ? fs + 14 : -14)}
              textAnchor="middle"
              fontSize={fs}
              fontWeight="800"
              fill={exit.pnl >= 0 ? "var(--positive)" : "var(--negative)"}
            >
              {exit.kind === "liquidated" ? "LIQUIDATED" : signedUsd(exit.pnl)}
            </text>
          </g>
        )}

        {/* Head orb + price pill */}
        <circle cx={headX} cy={headY} r="11" fill={headColor} opacity=".18" className={entered ? undefined : "tut-head-wait"} />
        <circle cx={headX} cy={headY} r="5" fill={headColor} stroke="var(--surface)" strokeWidth="2" />
        <g transform={`translate(${pillX}, ${Math.min(baseline - 11, Math.max(pad.top - 4, headY - 11))})`}>
          <rect width={pillW} height="22" rx="6" fill={headColor} />
          <text x={pillW / 2} y="15" textAnchor="middle" fontSize={fsSmall} fontWeight="700" fill="var(--trade-contrast)" className="tabular-nums">
            {axisLabel(head.p, span)}
          </text>
        </g>
      </svg>
    </div>
  );
}
