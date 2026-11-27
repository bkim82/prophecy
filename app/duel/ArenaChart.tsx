"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { LOBBY_WINDOW_MS } from "@/app/feedConfig";
import {
  CHART_AREA_LOW,
  CHART_ORB_EDGE,
  CHART_ORB_MID,
  clockLabel,
  formatChartPrice,
  monotonePath,
  priceAt,
  useFrameClock,
  useReducedMotion,
  windowSlice,
  type ScrubPoint,
} from "@/app/MarketChart";
import type { PricePoint } from "@/app/usePriceFeed";

// The Arena lobby's chart (app/duel/page.tsx): a few minutes of price behind
// the head, which sits at NOW_FRAC of the plot so the outcome fan ahead of it
// has room. Shares MarketChart's easing clock, smoothing and scrub maths, and
// its look: line, glow, orb and pill in the market colour (--chart-line, set
// per [data-market]), the same entrance (line sweeps in → orb ignites → fan
// opens → pill slides in) and head animations, reusing its global mc-* classes.
// Its own: the 5-minute window, four labelled gridlines, no starfield (the
// card's radial glow is CSS). See docs/chart.md.

const PAD = { top: 18, right: 78, bottom: 26, left: 0 };
const NOW_FRAC = 0.68;
// Floor on the visible span: ±MIN_HALF_SPAN of the live price, so a quiet tape
// neither flatlines nor blows a one-tick flicker up to full height. Beyond it
// the axis fits the data, padded Y_PAD each side.
const MIN_HALF_SPAN = 0.0003;
const Y_PAD = 0.14;
const HEADROOM = 0.3;
// Time labels closer than this drop every other one (phones).
const MIN_TICK_GAP_PX = 56;
const GRID_LINES = 4;
const TICK_MS = 60 * 1000;
const HEAD_TAU_MS = 140;
const RANGE_TAU_MS = 320;
const EDGE_SLACK_MS = 250;
const RAYS = [-1, -0.55, -0.2, 0.2, 0.55, 1];
const SPARKS = 5;
// Two samples closer than this are one moment (a 1-min candle's close and the
// next candle's open land ~1ms apart in the history seed).
const SAME_MOMENT_MS = 250;

/**
 * The points the line is drawn through. The feed carries the last price
 * forward every second and the history seed emits each candle as open + close,
 * so the raw series holds flat runs that end in a near-vertical jump — a
 * staircase. Keeping only the samples where the price actually moved (plus the
 * window's first and last) lets the curve interpolate across the gaps instead.
 */
export function lineKnots(points: PricePoint[]): PricePoint[] {
  if (points.length <= 2) return points;
  const knots: PricePoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const prev = knots[knots.length - 1];
    if (point.p === prev.p) continue;
    if (point.t - prev.t < SAME_MOMENT_MS && knots.length > 1) knots[knots.length - 1] = point;
    else knots.push(point);
  }
  const last = points[points.length - 1];
  const tail = knots[knots.length - 1];
  if (last.t - tail.t < SAME_MOMENT_MS && knots.length > 1) knots[knots.length - 1] = last;
  else knots.push(last);
  return knots;
}

const minuteLabel = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });

/** Decimals that tell gridlines `step` apart, capped at the market's own precision. */
function gridDecimals(step: number, tickSize: number) {
  const tickDecimals = Math.max(0, Math.round(-Math.log10(tickSize)));
  return Math.min(tickDecimals, Math.max(0, Math.ceil(-Math.log10(step))));
}

const spokenWindow = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${Math.round(ms / 1000)} seconds`);

type Props = {
  points: PricePoint[];
  now: number;
  label: string;
  tickSize: number;
  onScrub?: (point: ScrubPoint) => void;
  windowMs?: number;
};

export function ArenaChart({ points, now, label, tickSize, onScrub, windowMs = LOBBY_WINDOW_MS }: Props) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height: HEIGHT } = size;
  const [hoverX, setHoverX] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const clock = useFrameClock(now, !reduced);
  const anim = useRef<{ at: number; head: number; low: number; high: number } | null>(null);
  useEffect(() => { anim.current = null; }, [label]);

  // Pill flash on every live move, coloured by direction.
  const liveP = points.at(-1)?.p;
  const prevLiveP = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState({ key: 0, dir: "up" as "up" | "down" });
  useEffect(() => {
    const prev = prevLiveP.current;
    prevLiveP.current = liveP;
    if (prev === undefined || liveP === undefined || liveP === prev) return;
    setFlash((f) => ({ key: f.key + 1, dir: liveP > prev ? "up" : "down" }));
  }, [liveP]);
  useEffect(() => { prevLiveP.current = undefined; }, [label]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const pinned = useMemo(() => {
    const last = points.at(-1);
    if (!last || last.t < now - EDGE_SLACK_MS || clock <= last.t) return points;
    return [...points.slice(0, -1), { t: clock, p: last.p }];
  }, [points, now, clock]);

  // A dead feed freezes the window on its last data rather than going blank.
  const liveSlice = useMemo(() => windowSlice(pinned, clock - windowMs), [pinned, clock, windowMs]);
  const stale = liveSlice.length < 2 && pinned.length >= 2;
  const t1 = stale ? pinned[pinned.length - 1].t : Math.max(clock, pinned.at(-1)?.t ?? 0);
  const t0 = t1 - windowMs;
  const visible = useMemo(() => (stale ? windowSlice(pinned, t0) : liveSlice), [stale, pinned, t0, liveSlice]);
  const ready = visible.length >= 2 && width > 0 && HEIGHT > 0;

  const geo = useMemo(() => {
    if (!ready) return null;
    const plotW = width - PAD.left - PAD.right;
    const pastW = plotW * NOW_FRAC;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const bottom = PAD.top + plotH;
    const right = PAD.left + plotW;
    const prices = visible.map((point) => point.p);
    const rawLow = Math.min(...prices);
    const rawHigh = Math.max(...prices);
    const targetHead = visible[visible.length - 1].p;
    const mid = (rawHigh + rawLow) / 2;
    const half = Math.max(((rawHigh - rawLow) / 2) * (1 + 2 * Y_PAD), targetHead * MIN_HALF_SPAN, tickSize * 2);
    let targetLow = mid - half;
    let targetHigh = mid + half;
    // Keep HEADROOM of the span on both sides of the head so the fan always has
    // room to open, even when the price sits at the window's high or low.
    if (targetHigh - targetHead < HEADROOM * (targetHigh - targetLow)) targetHigh = (targetHead - HEADROOM * targetLow) / (1 - HEADROOM);
    if (targetHead - targetLow < HEADROOM * (targetHigh - targetLow)) targetLow = (targetHead - HEADROOM * targetHigh) / (1 - HEADROOM);

    // Exponential ease toward the targets; idempotent for a repeat render (dt = 0).
    const prev = anim.current;
    let low = targetLow;
    let high = targetHigh;
    let head = targetHead;
    if (prev && !reduced) {
      const dt = Math.max(0, t1 - prev.at);
      const kHead = 1 - Math.exp(-dt / HEAD_TAU_MS);
      const kRange = 1 - Math.exp(-dt / RANGE_TAU_MS);
      head = prev.head + (targetHead - prev.head) * kHead;
      low = prev.low + (targetLow - prev.low) * kRange;
      high = prev.high + (targetHigh - prev.high) * kRange;
      low = Math.min(low, rawLow, head);
      high = Math.max(high, rawHigh, head);
    }
    anim.current = { at: t1, head, low, high };

    const x = (t: number) => PAD.left + ((t - t0) / windowMs) * pastW;
    const y = (p: number) => PAD.top + (1 - (p - low) / (high - low)) * plotH;
    const knots = lineKnots(visible);
    const xs = knots.map((point) => x(point.t));
    const ys = knots.map((point, i) => y(i === knots.length - 1 ? head : point.p));
    const line = monotonePath(xs, ys);
    const headX = xs[xs.length - 1];
    const headY = ys[ys.length - 1];
    const area = `${line}L${headX.toFixed(2)},${bottom.toFixed(2)}L${xs[0].toFixed(2)},${bottom.toFixed(2)}Z`;
    const step = (high - low) / (GRID_LINES + 1);
    const decimals = gridDecimals(step, tickSize);
    const grid = Array.from({ length: GRID_LINES }, (_, i) => high - step * (i + 1)).map((p) => ({
      y: y(p),
      text: p.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      // The live price pill owns its row.
      hidden: Math.abs(y(p) - headY) < 16,
    }));
    const tickPx = (TICK_MS / windowMs) * pastW;
    const tickStep = TICK_MS * Math.max(1, Math.ceil(MIN_TICK_GAP_PX / tickPx));
    const ticks: number[] = [];
    for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1; t += tickStep) ticks.push(t);
    const reachUp = Math.min(plotH * 0.42, headY - PAD.top);
    const reachDown = Math.min(plotH * 0.42, bottom - headY);
    const open = visible[0].p;
    return { knots, pastW, plotH, bottom, right, x, y, line, area, open, baseY: y(open), last: visible[visible.length - 1], headX, headY, grid, ticks, reachUp, reachDown };
  }, [ready, width, visible, t0, t1, tickSize, HEIGHT, reduced, windowMs]);

  const scrub = useMemo(() => {
    if (!geo || hoverX === null) return null;
    const clampedX = Math.min(Math.max(hoverX, PAD.left), geo.headX);
    const t = t0 + ((clampedX - PAD.left) / geo.pastW) * windowMs;
    const p = priceAt(geo.knots, t);
    return p === null ? null : { x: clampedX, y: geo.y(p), t, p };
  }, [geo, hoverX, t0, windowMs]);

  // 100ms buckets keep a held pointer from re-rendering the page every frame.
  const scrubKey = scrub ? `${Math.round(scrub.t / 100)}:${scrub.p.toFixed(6)}` : "";
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  useEffect(() => {
    onScrubRef.current?.(scrub ? { t: scrub.t, p: scrub.p } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubKey]);
  useEffect(() => () => onScrubRef.current?.(null), []);

  const pointerX = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverX(((event.clientX - rect.left) / rect.width) * width);
  };

  const pillW = PAD.right - 6;
  const formatPrice = (price: number) => formatChartPrice(price, tickSize);
  const change = geo ? geo.last.p - geo.open : 0;
  const ariaLabel = geo
    ? `${label} price over the last ${spokenWindow(windowMs)}, now ${formatPrice(geo.last.p)}, ${change >= 0 ? "up" : "down"} ${formatPrice(Math.abs(change))}, with a fan of possible outcomes ahead`
    : `Loading ${label} price`;

  return (
    <div className={`arena-chart${scrub ? " is-scrubbing" : ""}${stale ? " is-stale" : ""}`} ref={wrapRef}>
      {width > 0 && HEIGHT > 0 && !geo && (
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={ariaLabel} className="arena-chart-loading">
          <line x1={PAD.left} x2={width - PAD.right} y1={HEIGHT / 2} y2={HEIGHT / 2} />
          <rect x={PAD.left} y={HEIGHT / 2 - 1.5} width={(width - PAD.left - PAD.right) * 0.3} height="3" rx="1.5" />
        </svg>
      )}
      {geo && (
        <svg
          key={label}
          className="arena-chart-svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={pointerX}
          onPointerDown={pointerX}
          onPointerLeave={() => setHoverX(null)}
          onPointerCancel={() => setHoverX(null)}
        >
          <defs>
            {/* Line in the market's own colour (BTC amber, ETH blue, NVDA green), fading in from the left. */}
            <linearGradient id={`${uid}-stroke`} gradientUnits="userSpaceOnUse" x1={PAD.left} x2={geo.headX} y1="0" y2="0">
              <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".15" />
              <stop offset=".5" stopColor="var(--chart-line)" stopOpacity=".85" />
              <stop offset="1" stopColor="var(--chart-point)" stopOpacity="1" />
            </linearGradient>
            {/* Dark: line colour fading into a violet wash. Moonstone (--chart-area-*): the line colour alone, 12% → 0. */}
            <linearGradient id={`${uid}-area`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={geo.bottom}>
              <stop offset="0" style={{ stopColor: "var(--chart-line)", stopOpacity: "var(--chart-area-top, .3)" }} />
              <stop offset=".55" style={{ stopColor: CHART_AREA_LOW, stopOpacity: "var(--chart-area-mid, .1)" }} />
              <stop offset="1" style={{ stopColor: CHART_AREA_LOW, stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1={PAD.left} x2={geo.headX} y1="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".3" stopColor="#fff" stopOpacity="1" />
            </linearGradient>
            <mask id={`${uid}-mask`}>
              <rect x="0" y="0" width={width} height={HEIGHT} fill={`url(#${uid}-fade)`} />
            </mask>
            <linearGradient id={`${uid}-now`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={geo.bottom}>
              <stop offset="0" stopColor="var(--brand)" stopOpacity="0" />
              <stop offset=".5" stopColor="var(--brand)" stopOpacity=".55" />
              <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-cone-up`} gradientUnits="userSpaceOnUse" x1={geo.headX} x2={geo.right} y1="0" y2="0">
              <stop offset="0" style={{ stopColor: "var(--fan-up, var(--positive))", stopOpacity: "var(--fan-fill-opacity, .28)" }} />
              <stop offset="1" style={{ stopColor: "var(--fan-up, var(--positive))", stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={`${uid}-cone-down`} gradientUnits="userSpaceOnUse" x1={geo.headX} x2={geo.right} y1="0" y2="0">
              <stop offset="0" style={{ stopColor: "var(--fan-down, var(--negative))", stopOpacity: "var(--fan-fill-opacity, .28)" }} />
              <stop offset="1" style={{ stopColor: "var(--fan-down, var(--negative))", stopOpacity: 0 }} />
            </linearGradient>
            <radialGradient id={`${uid}-aura`}>
              <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".45" />
              <stop offset=".45" stopColor="var(--violet)" stopOpacity=".14" />
              <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
            </radialGradient>
            {/* Lit orb in dark; --chart-dot-white turns it solid white for Moonstone's ringed dot (.mc-orb). */}
            <radialGradient id={`${uid}-orb`} cx=".38" cy=".35" r=".7">
              <stop offset="0" style={{ stopColor: "var(--chart-dot-core)" }} />
              <stop offset=".45" style={{ stopColor: CHART_ORB_MID }} />
              <stop offset="1" style={{ stopColor: CHART_ORB_EDGE }} />
            </radialGradient>
            <filter id={`${uid}-glow`} x="-10%" y="-60%" width="120%" height="220%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          <g className="arena-chart-grid" aria-hidden="true">
            {geo.grid.map((row, i) => (
              <g key={i} className="arena-chart-grid-row" style={{ "--i": i } as CSSProperties}>
                <line x1={PAD.left} x2={geo.right} y1={row.y} y2={row.y} />
                {!row.hidden && <text x={width - 4} y={row.y + 3.5} textAnchor="end">{row.text}</text>}
              </g>
            ))}
            <g className="mc-ticks">
              {geo.ticks.map((t) => {
                const tx = geo.x(t);
                if (tx < PAD.left + 22 || tx > geo.headX - 22) return null;
                return <text key={t} x={tx} y={HEIGHT - 7} textAnchor="middle">{minuteLabel(t)}</text>;
              })}
            </g>
          </g>

          {/* The unknown: a fan of possible paths from the head, up and down. */}
          <g className="mc-future" aria-hidden="true" style={{ transformOrigin: `${geo.headX}px ${geo.headY}px` }}>
            <path d={`M${geo.headX},${geo.headY}L${geo.right},${geo.headY - geo.reachUp}L${geo.right},${geo.headY}Z`} fill={`url(#${uid}-cone-up)`} />
            <path d={`M${geo.headX},${geo.headY}L${geo.right},${geo.headY + geo.reachDown}L${geo.right},${geo.headY}Z`} fill={`url(#${uid}-cone-down)`} />
            {RAYS.map((k) => (
              <line
                key={k}
                className={`mc-ray ${k < 0 ? "is-up" : "is-down"}`}
                x1={geo.headX}
                y1={geo.headY}
                x2={geo.right}
                y2={geo.headY + k * (k < 0 ? geo.reachUp : geo.reachDown)}
              />
            ))}
          </g>
          <line className="mc-now" x1={geo.headX} x2={geo.headX} y1={PAD.top} y2={geo.bottom} stroke={`url(#${uid}-now)`} />

          {/* Where the window opened. */}
          <line className="market-chart-open" x1={PAD.left} x2={geo.headX} y1={geo.baseY} y2={geo.baseY} />

          <g className="mc-reveal">
            <path d={geo.area} fill={`url(#${uid}-area)`} mask={`url(#${uid}-mask)`} className="mc-area" />
            <path className="market-chart-glow" d={geo.line} filter={`url(#${uid}-glow)`} style={{ stroke: `url(#${uid}-stroke)` }} />
            <path className="market-chart-line" d={geo.line} style={{ stroke: `url(#${uid}-stroke)` }} />
          </g>

          <line className="market-chart-live" x1={geo.headX} x2={width - pillW - 4} y1={geo.headY} y2={geo.headY} />
          <g transform={`translate(${width - pillW - 2}, ${geo.headY - 12})`}>
            <g className="mc-pill-in">
              <rect className="arena-chart-pill" width={pillW} height="24" rx="12" />
              {flash.key > 0 && <rect key={flash.key} className={`market-chart-pill-flash is-${flash.dir}`} width={pillW} height="24" rx="12" />}
              <text className="arena-chart-pill-text" x={pillW / 2} y="16" textAnchor="middle">{formatPrice(geo.last.p)}</text>
            </g>
          </g>

          <g transform={`translate(${geo.headX}, ${geo.headY})`} className={scrub ? "mc-head-dim" : undefined}>
            <circle className="mc-aura" r="70" fill={`url(#${uid}-aura)`} />
            <g className="mc-head-pop">
              <circle className="mc-shock" r="6" />
              {Array.from({ length: SPARKS }, (_, i) => (
                <circle key={i} className="mc-spark" r={1.6 - i * 0.2} style={{ animationDelay: `${(i * 1.4) / SPARKS}s` }} />
              ))}
              <circle className="mc-halo" r="12" />
              <circle className="market-chart-ping" r="6" />
              {flash.key > 0 && <circle key={flash.key} className={`market-chart-ripple is-${flash.dir}`} r="6" />}
              <circle className="mc-orb" r="5.5" fill={`url(#${uid}-orb)`} />
            </g>
          </g>

          {stale && (
            <g className="arena-chart-stale" transform={`translate(${PAD.left + 10}, ${PAD.top + 4})`}>
              <rect width="108" height="22" rx="11" />
              <circle cx="13" cy="11" r="3" />
              <text x="23" y="15">Reconnecting…</text>
            </g>
          )}

          {scrub && (() => {
            const delta = scrub.p - geo.open;
            const tipW = 128;
            const tipX = Math.min(Math.max(scrub.x - tipW / 2, PAD.left), geo.right - tipW);
            return (
              <g className="arena-chart-scrub">
                <line x1={scrub.x} x2={scrub.x} y1={24} y2={geo.bottom} />
                <circle cx={scrub.x} cy={scrub.y} r="4.5" />
                <g transform={`translate(${tipX}, 0)`}>
                  <rect width={tipW} height="20" rx="10" />
                  <text x="10" y="14">{clockLabel(scrub.t)}</text>
                  <text className={delta >= 0 ? "is-up" : "is-down"} x={tipW - 10} y="14" textAnchor="end">
                    {delta >= 0 ? "+" : "−"}{formatPrice(Math.abs(delta))}
                  </text>
                </g>
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}
