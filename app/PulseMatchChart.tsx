"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WINDOW_MS } from "./feedConfig";
import type { PricePoint } from "./usePriceFeed";

/**
 * The in-match Pulse chart (app/PulseMatch.tsx): drawn in real pixels (the
 * viewBox follows the box the screen's flex column hands it), so labels are
 * true px sizes at any height. Before entry: a lavender line, soft area and
 * the up/down outcome fan at "now". In a position: a dashed entry line with a
 * side pill, the gap between price and entry shaded green (profit) or red
 * (loss), the post-entry line coloured by P&L, floating +$/−$ labels off the
 * head on big ticks, and the liquidation line once price nears it.
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
  /** "Bitcoin" next to the pair, and its glyph (₿) watermarked behind the plot. */
  marketName?: string;
  glyph?: string;
};

// top clears the price header (.pm-chart-head).
const PAD = { top: 70, right: 58, bottom: 12, left: 0 };
// Room right of the head for the outcome fan, like the lobby chart.
const FORWARD_FRAC = 0.2;

// Theme tokens from .pm-screen (app/globals.css), so the chart follows the
// active colour scheme; SVG presentation attributes accept var().
const C = {
  // The market's own line colour (--pm-coin, app/globals.css) before entry.
  line: "var(--pm-coin)",
  grid: "var(--pm-raised)",
  axis: "var(--pm-muted)",
  green: "var(--pm-green)",
  greenBright: "var(--pm-green-bright)",
  red: "var(--pm-red)",
  redBright: "var(--pm-red-bright)",
  bg: "var(--pm-field)",
  text: "var(--pm-text)",
  soft: "var(--pm-soft)",
  greenPill: "color-mix(in srgb, var(--pm-green) 14%, var(--pm-field))",
  redPill: "color-mix(in srgb, var(--pm-red) 15%, var(--pm-field))",
  greenPillText: "color-mix(in srgb, var(--pm-green) 45%, var(--pm-text))",
  redPillText: "color-mix(in srgb, var(--pm-red) 40%, var(--pm-text))",
  liqPill: "color-mix(in srgb, var(--pm-red) 22%, var(--pm-field))",
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
  points, now, frozen, marketLabel, price, entry, positionPnl, liq, markers, pnlThreshold, marketName, glyph,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const headRef = useRef({ x: 0, y: 0 });
  const prevPriceRef = useRef<number | null>(null);
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

  // ▲/▼ follows the last tick that actually moved.
  useEffect(() => {
    const prev = prevPriceRef.current;
    prevPriceRef.current = price;
    if (prev === null || price === null || price === prev) return;
    setDir(price > prev ? "up" : "down");
  }, [price]);

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

  const priceColor = dir === "up" ? C.greenBright : dir === "down" ? C.redBright : C.text;
  const mark = glyph ? <span className="pm-chart-mark" aria-hidden="true">{glyph}</span> : null;
  const header = (
    <div className="pm-chart-head">
      <span className="pm-chart-pair">
        {marketLabel} / USD{marketName && <span className="pm-chart-name"> · {marketName}</span>}
      </span>
      <span className="pm-chart-price pm-num" style={{ color: priceColor }}>
        {/* SVG, not ▲/▼: those fall back to an oversized glyph in the mono font. */}
        {dir && (
          <svg className="pm-chart-dir" viewBox="0 0 10 10" aria-hidden="true">
            <path d={dir === "up" ? "M5 1.5L9.5 8.5H0.5Z" : "M5 8.5L9.5 1.5H0.5Z"} fill="currentColor" />
          </svg>
        )}
        {price === null ? "—" : priceText(price)}
      </span>
    </div>
  );

  if (!ready) {
    return (
      <div ref={boxRef} className="pm-chart-box">
        {mark}
        {header}
        <p className="pm-chart-wait">Waiting for price data…</p>
      </div>
    );
  }

  const { w, h } = size;
  const plotRight = w - PAD.right;
  const dataRight = PAD.left + (plotRight - PAD.left) * (1 - FORWARD_FRAC);
  const baseline = h - PAD.bottom;
  const innerH = Math.max(20, baseline - PAD.top);

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

  const x = (t: number) => PAD.left + ((t - t0) / WINDOW_MS) * (dataRight - PAD.left);
  const y = (p: number) => PAD.top + ((high - p) / (high - low)) * innerH;

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

  const reachUp = Math.min(innerH * 0.22, headY - PAD.top);
  const reachDown = Math.min(innerH * 0.22, baseline - headY);
  const fanX = plotRight - 18;

  const entryLabel = entry ? `${entry.side === "long" ? "LONG" : "SHORT"} @ ${priceText(entry.p, decimals)}` : "";
  const entryColor = entry?.side === "short" ? C.red : C.green;
  const pillW = 32 + entryLabel.length * 6.3;
  // Pill sits under the line unless that would run off the bottom.
  const pillY = entryY + 30 > baseline ? entryY - 28 : entryY + 6;

  const liqY = showLiq ? y(liq.price) : 0;
  const liqText = showLiq ? `LIQ ${priceText(liq.price, decimals)}` : "";

  const label = [
    `${marketLabel} price over the last minute${price !== null ? `, now ${priceText(price)}` : ""}`,
    entry ? `; your ${entry.side} from ${priceText(entry.p)} is ${inProfit ? "in profit" : "losing"}` : "",
    showLiq ? `; liquidation price ${priceText(liq.price)} is close` : "",
  ].join("");

  return (
    <div ref={boxRef} className={`pm-chart-box${entry ? (inProfit ? " is-up" : " is-down") : ""}`}>
      {mark}
      {header}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="pm-chart-svg">
        <defs>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.line} stopOpacity="0.2" />
            <stop offset="1" stopColor={C.line} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-profit`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.green} stopOpacity={profitAbove ? 0.42 : 0.06} />
            <stop offset="1" stopColor={C.green} stopOpacity={profitAbove ? 0.06 : 0.42} />
          </linearGradient>
          <linearGradient id={`${uid}-loss`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.red} stopOpacity={profitAbove ? 0.06 : 0.42} />
            <stop offset="1" stopColor={C.red} stopOpacity={profitAbove ? 0.42 : 0.06} />
          </linearGradient>
          <linearGradient id={`${uid}-line`} gradientUnits="userSpaceOnUse" x1={xs[0]} x2={headX} y1="0" y2="0">
            {entry ? (
              <>
                <stop offset="0" stopColor={C.line} stopOpacity="0.35" />
                <stop offset={entryFrac} stopColor={C.line} stopOpacity="0.7" />
                <stop offset={Math.min(1, entryFrac + 0.001)} stopColor={pnlStroke} />
                <stop offset="1" stopColor={pnlStroke} />
              </>
            ) : (
              <>
                <stop offset="0" stopColor={C.line} stopOpacity="0.45" />
                <stop offset="1" stopColor={C.line} />
              </>
            )}
          </linearGradient>
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0" stopColor={headColor} stopOpacity="0.65" />
            <stop offset="1" stopColor={headColor} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-above`}><rect x="0" y="0" width={w} height={Math.max(0, entryY)} /></clipPath>
          <clipPath id={`${uid}-below`}><rect x="0" y={entryY} width={w} height={Math.max(0, h - entryY)} /></clipPath>
        </defs>

        <g>
          {gridValues.map((value) => {
            const gy = y(value);
            return (
              <g key={value}>
                <line x1={PAD.left} x2={plotRight} y1={gy} y2={gy} stroke={C.grid} />
                {Math.abs(gy - headY) > 12 && (
                  <text x={w - 6} y={gy + 3.5} textAnchor="end" className="pm-chart-axis">{priceText(value, decimals)}</text>
                )}
              </g>
            );
          })}
        </g>

        {!entry && <path d={`${lineD}L${headX},${baseline}L${xs[0]},${baseline}Z`} fill={`url(#${uid}-area)`} />}

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
            <g transform={`translate(${Math.max(8, dataRight - 104)}, ${liqY < PAD.top + 24 ? liqY + 5 : liqY - 25})`}>
              <rect width="96" height="20" rx="10" fill={C.liqPill} stroke={C.red} />
              <text x="48" y="14" textAnchor="middle" className="pm-chart-pill-text" fill={C.redBright}>{liqText}</text>
            </g>
          </g>
        )}

        {!entry && !frozen && (
          <g className="pm-fan" pointerEvents="none">
            <path d={`M${headX},${headY}L${fanX},${headY - reachUp}L${fanX},${headY - reachUp * 0.3}Z`} fill={C.green} opacity="0.14" />
            <path d={`M${headX},${headY}L${fanX},${headY + reachDown * 0.3}L${fanX},${headY + reachDown}Z`} fill={C.red} opacity="0.14" />
            <g strokeDasharray="3 4" fill="none">
              <line x1={headX} y1={headY} x2={fanX} y2={headY - reachUp} stroke={C.green} opacity="0.7" />
              <line x1={headX} y1={headY} x2={fanX} y2={headY - reachUp * 0.3} stroke={C.green} opacity="0.35" />
              <line x1={headX} y1={headY} x2={fanX} y2={headY + reachDown * 0.3} stroke={C.red} opacity="0.35" />
              <line x1={headX} y1={headY} x2={fanX} y2={headY + reachDown} stroke={C.red} opacity="0.7" />
            </g>
            {reachUp > 12 && <text x={fanX + 3} y={headY - reachUp + 4} className="pm-chart-fan" fill={C.green}>UP</text>}
            {reachDown > 12 && <text x={fanX + 3} y={headY + reachDown + 4} className="pm-chart-fan" fill={C.red}>DN</text>}
          </g>
        )}

        <path d={lineD} fill="none" stroke={`url(#${uid}-line)`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

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

        <circle cx={headX} cy={headY} r="24" fill={`url(#${uid}-glow)`} className={frozen ? undefined : "pm-head-glow"} />
        <circle cx={headX} cy={headY} r="5.5" fill="#FFFFFF" stroke={headColor} strokeWidth="2.5" />
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
