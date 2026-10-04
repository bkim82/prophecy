"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FlameIcon } from "./icons";
import type { PricePoint } from "./usePriceFeed";

// Lobby ticker chart, in Prophecy's palette with the line in the market's own
// colour: a line under a slow starfield, an orb at the head, and a fan of possible paths ahead of it
// (the up/down call the player is about to make). Unlike app/PriceChart.tsx
// (the in-round chart) it has no axes to configure and no trade markers — it
// is a glanceable, scrubbable read of the last few seconds. Points sit at their real timestamps over a
// fixed window ending at `now`, so a gap in ticks reads as a gap in time, and
// the price axis fits the visible slice tightly so a few dollars on BTC is a
// visible swing.

export const MARKET_CHART_WINDOW_MS = 30 * 1000;

const DEFAULT_HEIGHT = 148;
const PAD = { top: 16, right: 70, bottom: 22, left: 2 };
// Visible span padded this much each side so the line never kisses the frame.
const Y_PAD = 0.14;
// Floor on the fitted span, in the market's price ticks. Without it a near-flat
// window blows a one-tick flicker up to full height; as a % of price it was
// so wide that a quiet 30s of BTC (a few dimes) drew as a flat line.
const MIN_SPAN_TICKS = 10;
const TICK_MS = 10 * 1000;
const GRID_LINES = 4;
// Easing time constants. The head chases the live price and the y-range
// chases the fitted range, so a new tick glides in instead of snapping.
const HEAD_TAU_MS = 140;
const RANGE_TAU_MS = 320;
// The feed's live edge is stamped at its 100ms clock; anything this close to
// `now` is that edge, and gets re-pinned to the frame clock so it doesn't stutter.
const EDGE_SLACK_MS = 250;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// Per-frame clock. The feed ticks `now` every 100ms, which scrolls the axis in
// visible steps; a rAF clock scrolls it continuously.
function useFrameClock(fallback: number, enabled: boolean) {
  const [frame, setFrame] = useState(fallback);
  // Only queue the next frame once the last one has committed and run its
  // effects. When a render outlasts a frame, queuing anyway nests each update
  // inside the previous commit's effects and trips React's update-depth guard.
  const committed = useRef(true);
  const lastSet = useRef(0);
  useEffect(() => {
    committed.current = true;
  });
  useEffect(() => {
    if (!enabled) return;
    let id = 0;
    const loop = () => {
      const t = Date.now();
      // The time check covers a bailed-out update (same ms) that never commits.
      if (committed.current || t - lastSet.current > 250) {
        committed.current = false;
        lastSet.current = t;
        setFrame(t);
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [enabled]);
  return enabled ? Math.max(frame, fallback - 1000) : fallback;
}

export type ScrubPoint = { t: number; p: number } | null;

/** Price at `t`, interpolated between samples; clamps to the ends. */
export function priceAt(points: PricePoint[], t: number): number | null {
  if (points.length === 0) return null;
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

// Clip to [t0, …] and interpolate the crossing so the line starts on the edge.
function windowSlice(points: PricePoint[], t0: number) {
  const first = points.findIndex((point) => point.t >= t0);
  if (first === -1) return [];
  if (first === 0) return points;
  const p = priceAt(points, t0);
  return p === null ? points.slice(first) : [{ t: t0, p }, ...points.slice(first)];
}

// Monotone cubic (Fritsch–Carlson): smooth, but never overshoots a sample —
// a fake peak above the real high would be a lie on a price chart.
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

// Quote at the market's own precision: a third decimal on a 1¢-tick market
// is a price that can't trade.
export function formatChartPrice(value: number, tickSize: number) {
  const decimals = Math.max(0, Math.round(-Math.log10(tickSize)));
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export const clockLabel = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });


// A fixed starfield, seeded so server and client (and every re-render) agree.
// Positions are fractions of the plot; radius/twinkle vary per star.
const STARS = (() => {
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 54 }, (_, i) => ({
    fx: rand(),
    fy: rand(),
    r: 0.5 + rand() * 1.1,
    tone: i % 3,
    dur: 2.4 + rand() * 4,
    delay: -rand() * 6,
  }));
})();

// Share of the plot to the right of the head: "what comes next", drawn as a
// fan of possible paths up and down — the call the player is about to make.
const FUTURE_FRAC = 0.16;
const RAYS = [-1, -0.55, -0.2, 0.2, 0.55, 1];
// Nearest 1%/2%/3% label for each ray above, paired by index — the rays'
// visual reach stays volatility-scaled (geo.reachUp/Down), this is only the
// number shown in the confirm popup, not a recomputed geometry.
const RAY_PCT = [3, 2, 1, 1, 2, 3];
const SPARKS = 5;

type RayConfirm = { side: "long" | "short"; pct: number; price: number };
type RayToast = { key: number; side: "long" | "short"; price: number };

type Props = {
  points: PricePoint[];
  now: number;
  label: string;
  /** Smallest price increment the exchange quotes (Coinbase quote_increment). */
  tickSize: number;
  /** Pixel height, or "fill" to take the height CSS gives `.market-chart`. */
  height?: number | "fill";
  onScrub?: (point: ScrubPoint) => void;
  /** Visible span ending at `now`; defaults to the lobby's 30s. */
  windowMs?: number;
  /** Spacing of the time-axis labels. */
  tickMs?: number;
  /** Axis/pill/tooltip price text; defaults to the market's tick precision. */
  formatPrice?: (price: number) => string;
  /** Axis/tooltip time text; defaults to a HH:MM:SS clock. */
  formatTime?: (t: number) => string;
  /** Spoken window for the chart's label, e.g. "24 hours". */
  windowLabel?: string;
  /** Scroll the axis every frame. Off for long windows where a frame is invisible. */
  smooth?: boolean;
};

export function MarketChart({
  points,
  now,
  label,
  tickSize,
  height = DEFAULT_HEIGHT,
  onScrub,
  windowMs = MARKET_CHART_WINDOW_MS,
  tickMs = TICK_MS,
  formatPrice = (price) => formatChartPrice(price, tickSize),
  formatTime = clockLabel,
  windowLabel = `${windowMs / 1000} seconds`,
  smooth = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  const fill = height === "fill";
  const HEIGHT = fill ? boxHeight : height;
  const [hoverX, setHoverX] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const clock = useFrameClock(now, smooth && !reduced);
  // Eased head price and y-range, advanced once per frame inside `geo`.
  const anim = useRef<{ at: number; head: number; low: number; high: number } | null>(null);
  // A different market is a different price scale: never ease across it.
  useEffect(() => { anim.current = null; }, [label]);

  // Clicking a future-ray is a side thing, not part of any game: no embers
  // actually move, nothing is persisted — just a confirm popup and a toast.
  const [rayConfirm, setRayConfirm] = useState<RayConfirm | null>(null);
  const [rayToast, setRayToast] = useState<RayToast | null>(null);
  useEffect(() => { setRayConfirm(null); setRayToast(null); }, [label]);
  useEffect(() => {
    if (!rayToast) return;
    const id = setTimeout(() => setRayToast(null), 1800);
    return () => clearTimeout(id);
  }, [rayToast]);

  // Flash + ripple whenever the live price moves, coloured by direction.
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
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      setBoxHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Re-pin the feed's live edge to the frame clock so the head rides the right edge.
  const pinned = useMemo(() => {
    const last = points.at(-1);
    if (!last || last.t < now - EDGE_SLACK_MS || clock <= last.t) return points;
    return [...points.slice(0, -1), { t: clock, p: last.p }];
  }, [points, now, clock]);

  // Live: the window ends now. Stale (feed dead long enough that nothing is left
  // in the live window): freeze the window on the last data instead of going
  // blank, and say so.
  const liveSlice = useMemo(() => windowSlice(pinned, clock - windowMs), [pinned, clock, windowMs]);
  const stale = liveSlice.length < 2 && pinned.length >= 2;
  const t1 = stale ? pinned[pinned.length - 1].t : Math.max(clock, pinned.at(-1)?.t ?? 0);
  const t0 = t1 - windowMs;
  const visible = useMemo(
    () => (stale ? windowSlice(pinned, t0) : liveSlice),
    [stale, pinned, t0, liveSlice],
  );
  const ready = visible.length >= 2 && width > 0 && HEIGHT > 0;

  const geo = useMemo(() => {
    if (!ready) return null;
    const plotW = width - PAD.left - PAD.right;
    const pastW = plotW * (1 - FUTURE_FRAC);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const bottom = PAD.top + plotH;
    const prices = visible.map((point) => point.p);
    const rawLow = Math.min(...prices);
    const rawHigh = Math.max(...prices);
    const minSpan = tickSize * MIN_SPAN_TICKS;
    const span = Math.max(rawHigh - rawLow, minSpan);
    const mid = (rawHigh + rawLow) / 2;
    const targetLow = mid - span * (0.5 + Y_PAD);
    const targetHigh = mid + span * (0.5 + Y_PAD);
    const targetHead = visible[visible.length - 1].p;

    // Exponential ease toward the targets; frame-rate independent via dt.
    // Mutating the ref here is idempotent for a repeat render (dt = 0).
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
      // Never let the eased range clip the line it is framing.
      low = Math.min(low, rawLow, head);
      high = Math.max(high, rawHigh, head);
    }
    anim.current = { at: t1, head, low, high };

    const x = (t: number) => PAD.left + ((t - t0) / windowMs) * pastW;
    const y = (p: number) => PAD.top + (1 - (p - low) / (high - low)) * plotH;
    const xs = visible.map((point) => x(point.t));
    const ys = visible.map((point, i) => y(i === visible.length - 1 ? head : point.p));
    const line = monotonePath(xs, ys);
    const open = visible[0].p;
    const last = visible[visible.length - 1];
    const baseY = y(open);
    const headX = xs[xs.length - 1];
    const headY = ys[ys.length - 1];
    const area = `${line}L${headX.toFixed(2)},${bottom.toFixed(2)}L${xs[0].toFixed(2)},${bottom.toFixed(2)}Z`;
    const gridStep = (high - low) / GRID_LINES;
    const grid = Array.from({ length: GRID_LINES - 1 }, (_, i) => high - gridStep * (i + 1))
      .map((p) => ({ p, y: y(p) }))
      // The live price pill owns its row; a grid label under it is just noise.
      .filter((row) => Math.abs(row.y - headY) > 14);
    const ticks: number[] = [];
    for (let t = Math.ceil(t0 / tickMs) * tickMs; t <= t1; t += tickMs) ticks.push(t);
    // The fan opens from the head to the plot's right edge, clamped to the plot.
    const right = PAD.left + plotW;
    const reachUp = Math.min(plotH * 0.42, headY - PAD.top);
    const reachDown = Math.min(plotH * 0.42, bottom - headY);
    return { plotW, pastW, plotH, bottom, right, x, y, line, area, open, last, baseY, headX, headY, grid, ticks, reachUp, reachDown };
  }, [ready, width, visible, t0, t1, tickSize, HEIGHT, reduced, windowMs, tickMs]);

  const scrub = useMemo(() => {
    if (!geo || hoverX === null) return null;
    const clampedX = Math.min(Math.max(hoverX, PAD.left), geo.headX);
    const t = t0 + ((clampedX - PAD.left) / geo.pastW) * windowMs;
    const p = priceAt(visible, t);
    return p === null ? null : { x: clampedX, y: geo.y(p), t, p };
  }, [geo, hoverX, t0, visible, windowMs]);

  // The axis scrolls every frame, so a held pointer drifts in time; 100ms
  // buckets keep that from re-rendering the page at 60fps.
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

  const up = geo ? geo.last.p >= geo.open : true;
  const pillW = PAD.right - 8;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const openRayConfirm = (side: "long" | "short", pct: number) => {
    if (!geo) return;
    const price = geo.last.p * (1 + (side === "long" ? pct : -pct) / 100);
    setRayConfirm({ side, pct, price });
  };
  const confirmRay = () => {
    if (!rayConfirm) return;
    setRayToast({ key: Date.now(), side: rayConfirm.side, price: rayConfirm.price });
    setRayConfirm(null);
  };

  const stars = (
    <g className="mc-stars" aria-hidden="true">
      {STARS.map((star, i) => (
        <circle
          key={i}
          className={`mc-star tone-${star.tone}`}
          cx={PAD.left + star.fx * (width - PAD.left - PAD.right)}
          cy={PAD.top + star.fy * plotH}
          r={star.r}
          style={{ animationDuration: `${star.dur}s`, animationDelay: `${star.delay}s` }}
        />
      ))}
    </g>
  );

  return (
    <div
      className={`market-chart ${up ? "is-up" : "is-down"} ${scrub ? "is-scrubbing" : ""} ${fill ? "is-fill" : ""} ${stale ? "is-stale" : ""}`}
      ref={wrapRef}
      style={fill ? undefined : { height: HEIGHT }}
    >
      {width > 0 && HEIGHT > 0 && !geo && (
        // Loading: the same sky, with a scanning beam where the line will be.
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Loading ${label} price`} className="mc-loading">
          <defs>
            <linearGradient id={`${uid}-beam`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--violet)" stopOpacity="0" />
              <stop offset=".5" stopColor="var(--brand)" stopOpacity=".9" />
              <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {stars}
          <line className="mc-loading-track" x1={PAD.left} x2={width - PAD.right} y1={HEIGHT / 2} y2={HEIGHT / 2} />
          <rect className="mc-loading-beam" x={PAD.left} y={HEIGHT / 2 - 1.5} width={(width - PAD.left - PAD.right) * 0.3} height="3" rx="1.5" fill={`url(#${uid}-beam)`} />
        </svg>
      )}
      {geo && (
        <svg
          // New market → new mount → the entrance plays again.
          key={label}
          className="mc-svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`${label} price over the last ${windowLabel}`}
          onPointerMove={pointerX}
          onPointerDown={pointerX}
          onPointerLeave={() => setHoverX(null)}
          onPointerCancel={() => setHoverX(null)}
        >
          <defs>
            {/* Line in the market's own colour (BTC orange, ETH blue…), fading in from the left. */}
            <linearGradient id={`${uid}-stroke`} gradientUnits="userSpaceOnUse" x1={PAD.left} x2={geo.headX} y1="0" y2="0">
              <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".15" />
              <stop offset=".5" stopColor="var(--chart-line)" stopOpacity=".85" />
              <stop offset="1" stopColor="var(--chart-point)" stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`${uid}-area`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={geo.bottom}>
              <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".3" />
              <stop offset=".55" stopColor="var(--violet)" stopOpacity=".1" />
              <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
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
              <stop offset="0" stopColor="var(--positive)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--positive)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-cone-down`} gradientUnits="userSpaceOnUse" x1={geo.headX} x2={geo.right} y1="0" y2="0">
              <stop offset="0" stopColor="var(--negative)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--negative)" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`${uid}-aura`}>
              <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".45" />
              <stop offset=".45" stopColor="var(--violet)" stopOpacity=".14" />
              <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-orb`} cx=".38" cy=".35" r=".7">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset=".45" stopColor="var(--chart-point)" />
              <stop offset="1" stopColor="var(--chart-line)" />
            </radialGradient>
            <filter id={`${uid}-glow`} x="-10%" y="-60%" width="120%" height="220%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>

          {stars}

          <g className="mc-grid">
            {geo.grid.map((row, i) => (
              <g key={i} style={{ "--i": i } as React.CSSProperties}>
                <line className="market-chart-grid" x1={PAD.left} x2={geo.right} y1={row.y} y2={row.y} />
                <text className="market-chart-axis" x={width - 6} y={row.y + 3.5} textAnchor="end">{formatPrice(row.p)}</text>
              </g>
            ))}
          </g>

          <g className="mc-ticks">
            {geo.ticks.map((t) => {
              const tx = geo.x(t);
              if (tx < PAD.left + 24 || tx > geo.headX - 24) return null;
              return (
                <g key={t}>
                  <line className="market-chart-tick" x1={tx} x2={tx} y1={geo.bottom} y2={geo.bottom + 4} />
                  <text className="market-chart-axis" x={tx} y={HEIGHT - 5} textAnchor="middle">{formatTime(t)}</text>
                </g>
              );
            })}
          </g>

          {/* The unknown: a fan of possible paths from the head, up and down. */}
          <g className="mc-future" style={{ transformOrigin: `${geo.headX}px ${geo.headY}px` }}>
            <path d={`M${geo.headX},${geo.headY}L${geo.right},${geo.headY - geo.reachUp}L${geo.right},${geo.headY}Z`} fill={`url(#${uid}-cone-up)`} />
            <path d={`M${geo.headX},${geo.headY}L${geo.right},${geo.headY + geo.reachDown}L${geo.right},${geo.headY}Z`} fill={`url(#${uid}-cone-down)`} />
            {RAYS.map((k, i) => {
              const side: "long" | "short" = k < 0 ? "long" : "short";
              const pct = RAY_PCT[i];
              const y2 = geo.headY + k * (k < 0 ? geo.reachUp : geo.reachDown);
              return (
                <g
                  key={k}
                  className="mc-ray-group"
                  role="button"
                  tabIndex={0}
                  aria-label={`Confirm ${side} near ${side === "long" ? "+" : "-"}${pct}%`}
                  onClick={() => openRayConfirm(side, pct)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRayConfirm(side, pct);
                    }
                  }}
                >
                  <title>{`Confirm ${side === "long" ? "Long" : "Short"} · ${side === "long" ? "+" : "-"}${pct}%`}</title>
                  <line className="mc-ray-hit" x1={geo.headX} y1={geo.headY} x2={geo.right} y2={y2} />
                  <line className={`mc-ray ${side === "long" ? "is-up" : "is-down"}`} x1={geo.headX} y1={geo.headY} x2={geo.right} y2={y2} />
                </g>
              );
            })}
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
          <g transform={`translate(${width - pillW - 2}, ${geo.headY - 11})`}>
            <g className="mc-pill-in">
              <rect className="market-chart-pill" width={pillW} height="22" rx="11" />
              {flash.key > 0 && <rect key={flash.key} className={`market-chart-pill-flash is-${flash.dir}`} width={pillW} height="22" rx="11" />}
              <text className="market-chart-pill-text" x={pillW / 2} y="15" textAnchor="middle">{formatPrice(geo.last.p)}</text>
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
            <g className="mc-stale-chip" transform={`translate(${PAD.left + 10}, ${PAD.top + 4})`}>
              <rect width="104" height="20" rx="10" />
              <circle cx="12" cy="10" r="3" />
              <text x="22" y="14">Reconnecting…</text>
            </g>
          )}

          {scrub && (() => {
            const delta = scrub.p - geo.open;
            const tipW = 118;
            const tipX = Math.min(Math.max(scrub.x - tipW / 2, PAD.left), geo.right - tipW);
            return (
              <g className="market-chart-scrub">
                <line x1={scrub.x} x2={scrub.x} y1={22} y2={geo.bottom} />
                <circle cx={scrub.x} cy={scrub.y} r="4.5" className="mc-scrub-dot" />
                <g transform={`translate(${tipX}, 0)`}>
                  <rect className="market-chart-tip" width={tipW} height="18" rx="9" />
                  <text className="market-chart-tip-text" x="9" y="12.5">{formatTime(scrub.t)}</text>
                  <text className={`market-chart-tip-text ${delta >= 0 ? "change-up" : "change-down"}`} x={tipW - 9} y="12.5" textAnchor="end">
                    {delta >= 0 ? "+" : "−"}{formatPrice(Math.abs(delta))}
                  </text>
                </g>
              </g>
            );
          })()}
        </svg>
      )}

      {rayConfirm && (
        <div
          className="mc-ray-confirm-overlay"
          onClick={() => setRayConfirm(null)}
        >
          <div
            className={`mc-ray-confirm-card is-${rayConfirm.side === "long" ? "up" : "down"}`}
            role="dialog"
            aria-label={`Confirm ${rayConfirm.side}`}
            onClick={(event) => event.stopPropagation()}
          >
            <FlameIcon className="mc-ray-confirm-flame" />
            <strong>Confirm {rayConfirm.side === "long" ? "Long" : "Short"}</strong>
            <span className="muted">
              {label} near {formatChartPrice(rayConfirm.price, tickSize)} ({rayConfirm.side === "long" ? "+" : "-"}{rayConfirm.pct}%)
            </span>
            <div className="mc-ray-confirm-actions">
              <button type="button" onClick={() => setRayConfirm(null)}>Cancel</button>
              <button type="button" className={`mc-ray-confirm-go is-${rayConfirm.side === "long" ? "up" : "down"}`} onClick={confirmRay}>
                Confirm {rayConfirm.side === "long" ? "Long" : "Short"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rayToast && (
        <div key={rayToast.key} className={`mc-ray-toast is-${rayToast.side === "long" ? "up" : "down"}`}>
          <FlameIcon className="mc-ray-toast-flame" />
          {rayToast.side === "long" ? "Long" : "Short"} confirmed near {formatChartPrice(rayToast.price, tickSize)}
        </div>
      )}
    </div>
  );
}
