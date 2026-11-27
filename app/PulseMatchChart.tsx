"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WINDOW_MS } from "./feedConfig";
import type { PricePoint } from "./usePriceFeed";

/**
 * The in-match Pulse chart (app/PulseMatch.tsx): drawn in real pixels (the
 * viewBox follows the box the screen's flex column hands it), so labels are
 * true px sizes at any height. Header: pair, price, change since the window's
 * first tick, and the window's high/low. A glowing lime line fading in from
 * the left over a lime area, the live price as a haloed dot with a dashed
 * level line and a solid pill on the axis, and right of "now" the lighter
 * NEXT zone holding the long/short cones. In a position: a dashed entry line
 * with a side pill, the gap between price and entry shaded green (profit) or
 * red (loss), the post-entry line coloured by P&L, floating +$/−$ labels off
 * the head on big ticks, and the liquidation line once price nears it.
 */

export type MatchChartMarker = {
  t: number;
  p: number;
  side: "long" | "short";
  action: "entry" | "exit" | "reverse";
  /** "rival" draws dashed. */
  owner: "you" | "rival";
};

type Props = {
  points: PricePoint[];
  /** Wall clock driving the right edge, so the window scrolls on its own. */
  now: number;
  frozen: boolean;
  marketLabel: string;
  /** Headline price (last trade), shown top-left. */
  price: number | null;
  entry: { t: number; p: number; side: "long" | "short" } | null;
  /** Live P&L of the open position; colours the post-entry line and fill. */
  positionPnl: number;
  /** Shown only while `near`: price is within reach of the liquidation price. */
  liq: { price: number; near: boolean } | null;
  markers: MatchChartMarker[];
  /** A tick moving P&L by at least this much floats a label off the head. */
  pnlThreshold: number;
};

// top clears the price header (.pm-chart-head; shorter on phones); bottom
// holds the NEXT zone's label; right is the axis, widened to fit the labels.
const PAD = { top: 104, topCompact: 80, right: 62, bottom: 26, left: 0 };
// Room right of the head for the NEXT zone and its outcome cones.
const FORWARD_FRAC = 0.24;
// The line and area fade in over this share of the plot's width.
const FADE_FRAC = 0.16;
const NEXT_LABEL = `NEXT ${Math.round(WINDOW_MS / 1000)}s`;

// Tokens from .pm-screen (app/globals.css); SVG presentation attributes accept var().
const C = {
  // The chart accent (lime) before entry.
  line: "var(--pm-coin)",
  grid: "var(--pm-grid)",
  zone: "var(--pm-zone)",
  green: "var(--pm-green)",
  greenBright: "var(--pm-green-bright)",
  red: "var(--pm-red)",
  redBright: "var(--pm-red-bright)",
  bg: "var(--pm-panel)",
  text: "var(--pm-text)",
  soft: "var(--pm-soft)",
  ink: "var(--pm-bg)",
  greenPill: "color-mix(in srgb, var(--pm-green) 14%, var(--pm-panel))",
  redPill: "color-mix(in srgb, var(--pm-red) 15%, var(--pm-panel))",
  greenPillText: "color-mix(in srgb, var(--pm-green) 45%, var(--pm-text))",
  redPillText: "color-mix(in srgb, var(--pm-red) 40%, var(--pm-text))",
  liqPill: "color-mix(in srgb, var(--pm-red) 22%, var(--pm-panel))",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const priceText = (n: number, decimals = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function windowSlice(points: PricePoint[], t0: number): PricePoint[] {
  const first = points.findIndex((point) => point.t >= t0);
  if (first === -1) return [];
  if (first === 0) return points;
  const prev = points[first - 1];
  const next = points[first];
  const k = (t0 - prev.t) / (next.t - prev.t || 1);
  return [{ t: t0, p: prev.p + (next.p - prev.p) * k }, ...points.slice(first)];
}

function valueAt(points: PricePoint[], t: number): number {
  if (t <= points[0].t) return points[0].p;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (b.t >= t) {
      const a = points[i - 1];
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.p + (b.p - a.p) * f;
    }
  }
  return points[points.length - 1].p;
}

// Monotone cubic (Fritsch–Carlson), same as app/PriceChart.tsx: smooth but
// never overshoots a sample.
function monotonePath(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return "";
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  let path = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    path += `C${(xs[i] + h).toFixed(2)},${(ys[i] + m[i] * h).toFixed(2)} ${(xs[i + 1] - h).toFixed(2)},${(ys[i + 1] - m[i + 1] * h).toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return path;
}

type Pop = { id: number; text: string; up: boolean; x: number; y: number };

export default function PulseMatchChart({
  points, now, frozen, marketLabel, price, entry, positionPnl, liq, markers, pnlThreshold,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const headRef = useRef({ x: 0, y: 0 });
  const prevPnlRef = useRef<number | null>(null);
  const popIdRef = useRef(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([item]) => {
      const w = Math.round(item.contentRect.width);
      const h = Math.round(item.contentRect.height);
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : w > 0 && h > 0 ? { w, h } : null));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new position starts its own P&L baseline — entering isn't a "tick".
  const entryKey = entry ? `${entry.t}-${entry.side}` : null;
  useEffect(() => {
    prevPnlRef.current = null;
  }, [entryKey]);

  useEffect(() => {
    if (!entry || frozen) return;
    const prev = prevPnlRef.current;
    prevPnlRef.current = positionPnl;
    if (prev === null) return;
    const delta = positionPnl - prev;
    if (Math.abs(delta) < pnlThreshold) return;
    const id = ++popIdRef.current;
    const text = `${delta >= 0 ? "+" : "−"}$${Math.abs(delta).toFixed(2)}`;
    setPops((list) => [...list.slice(-2), { id, text, up: delta >= 0, x: headRef.current.x, y: headRef.current.y }]);
    window.setTimeout(() => setPops((list) => list.filter((pop) => pop.id !== id)), 1400);
    // Fires per P&L change only; entry/frozen gate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionPnl]);

  const t1 = frozen ? points[points.length - 1]?.t ?? now : Math.max(now, points[points.length - 1]?.t ?? now);
  const t0 = t1 - WINDOW_MS;
  const visible = windowSlice(points, t0);
  const ready = visible.length >= 2 && size !== null;

  // Change since the window's first tick, and the window's range.
  const first = visible[0]?.p ?? null;
  const change = price !== null && first ? ((price - first) / first) * 100 : null;
  const windowHigh = visible.length ? Math.max(...visible.map((point) => point.p)) : null;
  const windowLow = visible.length ? Math.min(...visible.map((point) => point.p)) : null;
  const header = (
    <>
      <div className="pm-chart-head">
        <span className="pm-chart-pair pm-num">{marketLabel} / USD</span>
        <span className="pm-chart-quote">
          <span className="pm-chart-price pm-num">{price === null ? "—" : priceText(price)}</span>
          {change !== null && (
            <span className={`pm-chart-change pm-num ${change >= 0 ? "is-up" : "is-down"}`}>
              {/* SVG, not ▲/▼: those fall back to an oversized glyph in the mono font. */}
              <svg className="pm-chart-dir" viewBox="0 0 10 10" aria-hidden="true">
                <path d={change >= 0 ? "M5 1.5L9.5 8.5H0.5Z" : "M5 8.5L9.5 1.5H0.5Z"} fill="currentColor" />
              </svg>
              {change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(2)}%
            </span>
          )}
        </span>
      </div>
      {windowHigh !== null && windowLow !== null && (
        <div className="pm-chart-range pm-num">
          <span><span className="pm-chart-range-key">H</span> {priceText(windowHigh)}</span>
          <span><span className="pm-chart-range-key">L</span> {priceText(windowLow)}</span>
        </div>
      )}
    </>
  );

  if (!ready) {
    return (
      <div ref={boxRef} className="pm-chart-box">
        {header}
        <p className="pm-chart-wait">Waiting for price data…</p>
      </div>
    );
  }

  const { w, h } = size;
  const padTop = w < 520 ? PAD.topCompact : PAD.top;

  const values = visible.map((point) => point.p);
  if (entry) values.push(entry.p);
  const showLiq = liq !== null && liq.near;
  if (showLiq) values.push(liq.price);
  const rawLow = Math.min(...values);
  const rawHigh = Math.max(...values);
  const span = Math.max(rawHigh - rawLow, rawHigh * 0.00015);
  const low = rawLow - span * 0.12;
  const high = rawHigh + span * 0.12;
  const decimals = high - low < 25 ? 2 : 0;

  // Axis column fits its widest label (mono 10.5px ≈ 6.4px a glyph).
  const axisChars = Math.max(priceText(high, decimals).length, priceText(low, decimals).length);
  const padRight = Math.max(PAD.right, Math.ceil(axisChars * 6.4) + 24);
  const plotRight = w - padRight;
  const dataRight = PAD.left + (plotRight - PAD.left) * (1 - FORWARD_FRAC);
  const baseline = h - PAD.bottom;
  const innerH = Math.max(20, baseline - padTop);

  const x = (t: number) => PAD.left + ((t - t0) / WINDOW_MS) * (dataRight - PAD.left);
  const y = (p: number) => padTop + ((high - p) / (high - low)) * innerH;

  const xs = visible.map((point) => x(point.t));
  const ys = visible.map((point) => y(point.p));
  const lineD = monotonePath(xs, ys);
  const headX = xs[xs.length - 1];
  const headY = ys[ys.length - 1];
  headRef.current = { x: headX, y: headY };

  const inProfit = positionPnl >= 0;
  const pnlStroke = inProfit ? C.greenBright : C.redBright;
  const headColor = entry ? pnlStroke : C.line;

  // Post-entry stretch of the line, for the profit/loss fill.
  let shadeD: string | null = null;
  let entryX = 0;
  let entryY = 0;
  if (entry) {
    entryY = y(entry.p);
    const startT = Math.max(entry.t, visible[0].t);
    entryX = x(startT);
    const sub = visible.filter((point) => point.t > startT);
    const subXs = [entryX, ...sub.map((point) => x(point.t))];
    const subYs = [y(valueAt(visible, startT)), ...sub.map((point) => y(point.p))];
    if (subXs.length >= 2) {
      shadeD = `${monotonePath(subXs, subYs)}L${headX.toFixed(2)},${entryY.toFixed(2)}L${entryX.toFixed(2)},${entryY.toFixed(2)}Z`;
    }
  }
  const entryFrac = entry ? clamp((entryX - xs[0]) / Math.max(1, headX - xs[0]), 0, 1) : 1;
  // Long profits above the entry line, short below.
  const profitAbove = entry?.side !== "short";

  const gridCount = 4;
  const gridValues = Array.from({ length: gridCount }, (_, i) => high - ((high - low) * (i + 0.5)) / gridCount);

  const reachUp = Math.min(innerH * 0.22, headY - padTop);
  const reachDown = Math.min(innerH * 0.22, baseline - headY);
  const fanX = plotRight - 14;
  const showZone = !frozen;

  const entryLabel = entry ? `${entry.side === "long" ? "LONG" : "SHORT"} @ ${priceText(entry.p, decimals)}` : "";
  const entryColor = entry?.side === "short" ? C.red : C.green;
  const pillW = 32 + entryLabel.length * 6.3;
  // Pill sits under the line unless that would run off the bottom.
  const pillY = entryY + 30 > baseline ? entryY - 28 : entryY + 6;

  const liqY = showLiq ? y(liq.price) : 0;
  const liqText = showLiq ? `LIQ ${priceText(liq.price, decimals)}` : "";

  const headPrice = priceText(visible[visible.length - 1].p, decimals);

  const label = [
    `${marketLabel} price over the last minute${price !== null ? `, now ${priceText(price)}` : ""}`,
    entry ? `; your ${entry.side} from ${priceText(entry.p)} is ${inProfit ? "in profit" : "losing"}` : "",
    showLiq ? `; liquidation price ${priceText(liq.price)} is close` : "",
  ].join("");

  return (
    <div ref={boxRef} className={`pm-chart-box${entry ? (inProfit ? " is-up" : " is-down") : ""}`}>
      {header}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="pm-chart-svg">
        <defs>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.line} stopOpacity="0.26" />
            <stop offset="1" stopColor={C.line} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-profit`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.green} stopOpacity={profitAbove ? 0.55 : 0.08} />
            <stop offset="1" stopColor={C.green} stopOpacity={profitAbove ? 0.08 : 0.55} />
          </linearGradient>
          <linearGradient id={`${uid}-loss`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.red} stopOpacity={profitAbove ? 0.08 : 0.55} />
            <stop offset="1" stopColor={C.red} stopOpacity={profitAbove ? 0.55 : 0.08} />
          </linearGradient>
          <linearGradient id={`${uid}-line`} gradientUnits="userSpaceOnUse" x1={xs[0]} x2={headX} y1="0" y2="0">
            {entry ? (
              <>
                <stop offset="0" stopColor={C.line} stopOpacity="0.85" />
                <stop offset={entryFrac} stopColor={C.line} />
                <stop offset={Math.min(1, entryFrac + 0.001)} stopColor={pnlStroke} />
                <stop offset="1" stopColor={pnlStroke} />
              </>
            ) : (
              <>
                <stop offset="0" stopColor={C.line} />
                <stop offset="1" stopColor={C.line} />
              </>
            )}
          </linearGradient>
          {/* Fades the line and area in from the left edge. */}
          <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1={PAD.left} x2={PAD.left + (dataRight - PAD.left) * FADE_FRAC} y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={`${uid}-fade-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
            <rect x="0" y="0" width={w} height={h} fill={`url(#${uid}-fade)`} />
          </mask>
          {/* Soft halo under the price line; user-space region so a flat line's tiny bounding box doesn't clip the blur. */}
          <filter id={`${uid}-blur`} filterUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <clipPath id={`${uid}-above`}><rect x="0" y="0" width={w} height={Math.max(0, entryY)} /></clipPath>
          <clipPath id={`${uid}-below`}><rect x="0" y={entryY} width={w} height={Math.max(0, h - entryY)} /></clipPath>
        </defs>

        {showZone && (
          <g pointerEvents="none">
            <rect x={headX} y="0" width={Math.max(0, w - headX)} height={h} fill={C.zone} />
            <line x1={headX} x2={headX} y1={padTop - 10} y2={baseline} stroke={C.soft} strokeOpacity="0.35" strokeDasharray="3 4" />
            <text x={(headX + plotRight) / 2} y={h - 9} textAnchor="middle" className="pm-chart-zone">{NEXT_LABEL}</text>
          </g>
        )}

        <g>
          {gridValues.map((value) => {
            const gy = y(value);
            return (
              <g key={value}>
                <line x1={PAD.left} x2={plotRight} y1={gy} y2={gy} stroke={C.grid} />
                {Math.abs(gy - headY) > 16 && (
                  <text x={w - 8} y={gy + 3.5} textAnchor="end" className="pm-chart-axis">{priceText(value, decimals)}</text>
                )}
              </g>
            );
          })}
        </g>

        {!entry && <path d={`${lineD}L${headX},${baseline}L${xs[0]},${baseline}Z`} fill={`url(#${uid}-area)`} mask={`url(#${uid}-fade-mask)`} />}

        {shadeD && (
          <>
            <path d={shadeD} fill={`url(#${uid}-${profitAbove ? "profit" : "loss"})`} clipPath={`url(#${uid}-above)`} />
            <path d={shadeD} fill={`url(#${uid}-${profitAbove ? "loss" : "profit"})`} clipPath={`url(#${uid}-below)`} />
          </>
        )}

        {entry && (
          <g pointerEvents="none">
            <line x1={PAD.left} x2={plotRight} y1={entryY} y2={entryY} stroke={entryColor} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.85" />
            <g transform={`translate(8, ${pillY})`}>
              <rect width={pillW} height="22" rx="11" fill={entry.side === "short" ? C.redPill : C.greenPill} stroke={entryColor} />
              <circle cx="12" cy="11" r="7" fill={entryColor} />
              <text x="12" y="14.5" textAnchor="middle" className="pm-chart-pill-avatar">Y</text>
              <text x="24" y="15" className="pm-chart-pill-text" fill={entry.side === "short" ? C.redPillText : C.greenPillText}>{entryLabel}</text>
            </g>
          </g>
        )}

        {showLiq && (
          <g pointerEvents="none" className="pm-chart-liq">
            <line x1={PAD.left} x2={plotRight} y1={liqY} y2={liqY} stroke={C.red} strokeWidth="1.5" strokeDasharray="3 3" />
            <g transform={`translate(${Math.max(8, dataRight - 104)}, ${liqY < padTop + 24 ? liqY + 5 : liqY - 25})`}>
              <rect width="96" height="20" rx="10" fill={C.liqPill} stroke={C.red} />
              <text x="48" y="14" textAnchor="middle" className="pm-chart-pill-text" fill={C.redBright}>{liqText}</text>
            </g>
          </g>
        )}

        {!entry && !frozen && (
          <g className="pm-fan" pointerEvents="none" strokeDasharray="4 4" strokeLinejoin="round">
            <path d={`M${headX},${headY}L${fanX},${headY - reachUp}L${fanX},${headY - reachUp * 0.3}Z`} fill={C.green} fillOpacity="0.16" stroke={C.green} strokeOpacity="0.85" />
            <path d={`M${headX},${headY}L${fanX},${headY + reachDown * 0.3}L${fanX},${headY + reachDown}Z`} fill={C.red} fillOpacity="0.16" stroke={C.red} strokeOpacity="0.85" />
            {reachUp > 12 && <text x={fanX} y={Math.max(headY - reachUp - 7, padTop - 4)} textAnchor="end" className="pm-chart-fan" fill={C.green}>LONG ↑</text>}
            {reachDown > 12 && <text x={fanX} y={Math.min(headY + reachDown + 15, baseline - 4)} textAnchor="end" className="pm-chart-fan" fill={C.red}>SHORT ↓</text>}
          </g>
        )}

        {/* The live price as a level across the plot. */}
        <line x1={PAD.left} x2={plotRight} y1={headY} y2={headY} stroke={headColor} strokeOpacity="0.55" strokeDasharray="4 5" pointerEvents="none" />

        <g mask={`url(#${uid}-fade-mask)`}>
          <path d={lineD} fill="none" stroke={`url(#${uid}-line)`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" filter={`url(#${uid}-blur)`} />
          <path d={lineD} fill="none" stroke={`url(#${uid}-line)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {markers.map((marker, i) => {
          if (marker.t < t0 || marker.t > t1) return null;
          const mx = x(marker.t);
          const my = y(clamp(marker.p, low, high));
          const color = marker.side === "long" ? C.green : C.red;
          const dash = marker.owner === "rival" ? "2 2" : undefined;
          return marker.action === "exit" ? (
            <rect key={i} x={mx - 4} y={my - 4} width="8" height="8" rx="2" fill={C.bg} stroke={color} strokeWidth="2" strokeDasharray={dash} />
          ) : (
            <circle key={i} cx={mx} cy={my} r="4" fill={C.bg} stroke={color} strokeWidth="2" strokeDasharray={dash} />
          );
        })}

        {/* Head: a white dot inside two halos. */}
        <circle cx={headX} cy={headY} r="18" fill={headColor} fillOpacity="0.14" className={frozen ? undefined : "pm-head-glow"} />
        <circle cx={headX} cy={headY} r="10" fill={headColor} fillOpacity="0.32" />
        <circle cx={headX} cy={headY} r="5" fill="#FFFFFF" />

        {/* Price pill on the axis. */}
        <g transform={`translate(${plotRight + 6}, ${clamp(headY, 11, h - 11) - 11})`} pointerEvents="none">
          <rect width={padRight - 12} height="22" rx="11" fill={headColor} />
          <text x={(padRight - 12) / 2} y="15" textAnchor="middle" className="pm-chart-price-pill" fill={C.ink}>{headPrice}</text>
        </g>
      </svg>
      <div className="pm-pops" aria-hidden="true">
        {pops.map((pop) => (
          <span key={pop.id} className={`pm-pop pm-num ${pop.up ? "is-up" : "is-down"}`} style={{ left: pop.x + 12, top: pop.y - 14 }}>
            {pop.text}
          </span>
        ))}
      </div>
    </div>
  );
}
