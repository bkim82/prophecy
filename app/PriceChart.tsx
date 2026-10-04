"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  MIN_WINDOW_MS,
  WINDOW_MS,
  X_INTERVALS,
  X_MINOR_PER_INTERVAL,
  Y_INTERVALS,
} from "./feedConfig";
import type { PricePoint } from "./usePriceFeed";

export type TradeMarker = {
  t: number;
  p: number;
  side: "long" | "short";
  action?: "entry" | "exit" | "reverse";
  /** Whose trade this is — distinguishes markers when two parties trade on
   * the same chart. Defaults to "you" so existing callers are unaffected.
   * Anyone other than "you" draws dashed. */
  owner?: "you" | "sibyl" | "room";
  /** Realized P&L, shown as a transient toast on the newest closing marker. */
  pnl?: number;
};

type Props = {
  points: PricePoint[];
  trades?: TradeMarker[];
  roundStart?: number | null;
  frozen?: boolean;
  /** While a position is open, draws a labeled dashed line at its entry price. */
  openEntry?: { t: number; p: number; side: "long" | "short" } | null;
  /** Wall clock driving the right edge; ticks so the window scrolls on its own. */
  now?: number;
  /** Axis divisions — defaults live in feedConfig. */
  windowMs?: number;
  /** Tightest the wheel will zoom to; windowMs is the widest. */
  minWindowMs?: number;
  xIntervals?: number;
  yIntervals?: number;
  xMinorPerInterval?: number;
};

const W = 880;
const H = 400;
const PRICE_AXIS_GAP = 16;
const PAD = { top: 20, right: 86, bottom: 44, left: 12 };
// Match the duel lobby chart: live data ends before the price axis, leaving a
// forward-looking region between the head and the Y-axis labels/pill.
const FORWARD_SPACE_FRAC = 0.16;
const FUTURE_RAYS = [-1, -0.55, -0.2, 0.2, 0.55, 1];
const FUTURE_BEAM_REACH_FRAC = 0.18;

const UP = "var(--chart-up)";
const DOWN = "var(--chart-down)";

const MIN_LABEL_GAP = 42; // px between clock labels before thinning

// Wheel zoom. Multiplicative, so a notch feels the same at either end of the
// range: ~1.16x per 100px notch, ~5 notches across the full 1min→30s span.
const ZOOM_RATE = 0.0015;
// Price zoom starts at the data-fitting range and only expands from there. A
// generous ceiling lets an off-screen trade marker be brought into view without
// letting the price line collapse all the way to a rounding error.
const MAX_PRICE_SCALE = 32;
// deltaY arrives in lines or pages on some browsers/devices; normalise to px so
// one notch isn't a 300x jump on Firefox.
const DELTA_PX = [1, 16, 400];

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// Tick steps that read as round wall-clock times, so any xIntervals lands on
// something a human recognises rather than on a 25.7s stride.
const NICE_STEPS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  600_000, 900_000, 1_800_000, 3_600_000,
];

const niceStep = (target: number) =>
  NICE_STEPS_MS.find((step) => step >= target) ??
  NICE_STEPS_MS[NICE_STEPS_MS.length - 1];

// Zoomed in far enough that a $5 move matters, so the labels need decimals.
const axisLabel = (n: number, span = Infinity) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: span < 25 ? 2 : 0,
    maximumFractionDigits: span < 25 ? 2 : 0,
  });

// The zoom level has to be legible, or the axis just silently means something
// different than it did a moment ago.
const spanLabel = (ms: number) => {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
};

const clockLabel = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * Clips the series to the window, interpolating the point where the line crosses
 * the left edge so a scrolled-past segment ends on the axis instead of floating
 * in from nowhere.
 */
function windowSlice(points: PricePoint[], t0: number): PricePoint[] {
  const first = points.findIndex((point) => point.t >= t0);
  if (first === -1) return []; // feed died; everything predates the window
  if (first === 0) return points;

  const prev = points[first - 1];
  const next = points[first];
  const k = (t0 - prev.t) / (next.t - prev.t);
  return [{ t: t0, p: prev.p + (next.p - prev.p) * k }, ...points.slice(first)];
}

/** Price at `t`, interpolated between samples; clamps to the ends. Drives the
 * hover crosshair — the only reader that needs a value *between* samples. */
function valueAt(points: PricePoint[], t: number): number | null {
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

// Monotone cubic (Fritsch–Carlson): smooth, but never overshoots a sample — a
// fake peak above the real high would be a lie on a price chart. Mirrors
// app/MarketChart.tsx's version; kept local rather than shared since the two
// charts are intentionally independent (see docs/chart.md).
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

// A fixed starfield, seeded so server and client agree. Fractions of the plot.
const STARS = (() => {
  let seed = 0x85ebca6b;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 34 }, (_, i) => ({
    fx: rand(),
    fy: rand(),
    r: 0.5 + rand() * 1.1,
    tone: i % 3,
    dur: 2.4 + rand() * 4,
    delay: -rand() * 6,
  }));
})();

export default function PriceChart({
  points,
  trades = [],
  roundStart = null,
  frozen = false,
  openEntry = null,
  now,
  windowMs = WINDOW_MS,
  minWindowMs = MIN_WINDOW_MS,
  xIntervals = X_INTERVALS,
  yIntervals = Y_INTERVALS,
  xMinorPerInterval = X_MINOR_PER_INTERVAL,
}: Props) {
  const uid = useId().replace(/:/g, "");
  // Zoom is a view concern, so it lives here rather than being plumbed through
  // every caller. Time and price remain independent axes.
  const [zoomMs, setZoomMs] = useState(windowMs);
  const [priceScale, setPriceScale] = useState(1);
  const [isCompact, setIsCompact] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // A fixed desktop viewBox makes SVG text shrink to a few pixels on phones.
  // Use a narrower, taller coordinate system at the actual rendered width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const update = () => setIsCompact(el.clientWidth <= 560);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chartWidth = isCompact ? 520 : W;
  const chartHeight = isCompact ? 440 : H;
  const chartPad = isCompact
    ? { top: 28, right: 100, bottom: 62, left: 18 }
    : PAD;
  const chartInnerWidth = chartWidth - chartPad.left - chartPad.right;
  const chartDataWidth = chartInnerWidth * (1 - FORWARD_SPACE_FRAC);
  const chartDataRight = chartPad.left + chartDataWidth;
  const chartInnerHeight = chartHeight - chartPad.top - chartPad.bottom;

  // Derived rather than corrected in an effect, so a windowMs change takes
  // effect on the same frame it arrives.
  const viewMs = clamp(zoomMs, minWindowMs, windowMs);
  const viewRef = useRef(viewMs);
  viewRef.current = viewMs;
  const priceScaleRef = useRef(priceScale);
  priceScaleRef.current = priceScale;

  const lastSample = points[points.length - 1];

  // Flash the head/pill whenever the live price moves a tick, colour matching
  // direction — same cue as the lobby chart (app/MarketChart.tsx).
  const [flash, setFlash] = useState({ key: 0, dir: "up" as "up" | "down" });
  const prevP = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prev = prevP.current;
    prevP.current = lastSample?.p;
    if (prev === undefined || lastSample === undefined || lastSample.p === prev) return;
    setFlash((f) => ({ key: f.key + 1, dir: lastSample.p > prev ? "up" : "down" }));
  }, [lastSample?.p]);

  // The window is a fixed span ending now, not the extent of the data: it holds
  // its width from the first frame, so the axis scrolls instead of compressing
  // as points accumulate. A settled chart pins the edge to its final point.
  const clock = now ?? Date.now();
  const t1 = lastSample
    ? frozen
      ? lastSample.t
      : Math.max(clock, lastSample.t)
    : clock;
  const t0 = t1 - viewMs;
  const futureMs = (viewMs * FORWARD_SPACE_FRAC) / (1 - FORWARD_SPACE_FRAC);
  const axisT1 = t1 + futureMs;

  const visible = windowSlice(points, t0);
  const ready = visible.length >= 2;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      const step = DELTA_PX[event.deltaMode] ?? 1;
      const svg = el.querySelector("svg");
      const svgRect = svg?.getBoundingClientRect();
      const plotRight = svgRect
        ? svgRect.left + ((chartPad.left + chartInnerWidth) / chartWidth) * svgRect.width
        : Infinity;

      // The right gutter is the price axis. Scrolling there changes only the
      // vertical range; scrolling over the plot retains the time-axis gesture.
      if (event.clientX >= plotRight) {
        const next = clamp(
          priceScaleRef.current *
            Math.exp(event.deltaY * step * ZOOM_RATE),
          1,
          MAX_PRICE_SCALE,
        );
        if (next === priceScaleRef.current) return;
        event.preventDefault();
        priceScaleRef.current = next;
        setPriceScale(next);
        return;
      }

      const next = clamp(
        viewRef.current * Math.exp(event.deltaY * step * ZOOM_RATE),
        minWindowMs,
        windowMs,
      );
      // Already at a limit in this direction: don't swallow the event, or the
      // chart becomes a 400px hole the page won't scroll past.
      if (next === viewRef.current) return;
      event.preventDefault();
      viewRef.current = next;
      setZoomMs(next);
    };

    // React registers onWheel passively, where preventDefault is a no-op.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // `ready` swaps the placeholder for the chart — a different element to bind.
  }, [windowMs, minWindowMs, ready]);

  if (!ready) {
    return (
      <div
        ref={containerRef}
        className="price-chart flex h-[clamp(280px,75vw,400px)] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--muted-dim)]"
      >
        Waiting for price data…
      </div>
    );
  }

  const prices = visible.map((point) => point.p);
  const rawLow = Math.min(...prices);
  const rawHigh = Math.max(...prices);
  // Tight padding: the visible range tracks the actual swing, so small moves
  // read as real peaks and dips instead of a near-flat line.
  const dataSpan = rawHigh - rawLow || rawHigh * 0.0002;
  const fittedLow = rawLow - dataSpan * 0.06;
  const fittedHigh = rawHigh + dataSpan * 0.06;
  const midpoint = (fittedLow + fittedHigh) / 2;
  const visibleSpan = (fittedHigh - fittedLow) * priceScale;
  const low = midpoint - visibleSpan / 2;
  const high = midpoint + visibleSpan / 2;

  const x = (t: number) => chartPad.left + ((t - t0) / viewMs) * chartDataWidth;
  const y = (p: number) => chartPad.top + ((high - p) / visibleSpan) * chartInnerHeight;

  const baseline = chartPad.top + chartInnerHeight;
  const last = visible[visible.length - 1];
  const open = visible[0].p;

  const xs = visible.map((pt) => x(pt.t));
  const ys = visible.map((pt) => y(pt.p));
  const lineD = monotonePath(xs, ys);
  const headX = xs[xs.length - 1];
  const headY = ys[ys.length - 1];
  const area = `${lineD}L${headX.toFixed(2)},${baseline.toFixed(2)}L${xs[0].toFixed(2)},${baseline.toFixed(2)}Z`;

  // Compare the latest value with the value at the left edge of the chart —
  // the same reference the hover tooltip's delta uses.
  const up = last.p >= open;
  const stroke = up ? UP : DOWN;

  const gridValues = Array.from(
    { length: yIntervals + 1 },
    (_, i) => high - (visibleSpan * i) / yIntervals,
  );

  // Ticks land on wall-clock boundaries of a round step, so every label reads as
  // a real time and the spacing holds as the window slides.
  const majorMs = niceStep(viewMs / Math.max(1, xIntervals));
  const minorMs = majorMs / Math.max(1, xMinorPerInterval);
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / minorMs) * minorMs; t <= axisT1; t += minorMs) {
    ticks.push(t);
  }
  // A tighter xIntervals would collide the clock labels, so thin them to
  // whatever multiple of the major step still fits.
  const pxPerMajor = (majorMs / viewMs) * chartDataWidth;
  const labelEvery =
    majorMs * Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, pxPerMajor)));

  const bandVisible = roundStart !== null && roundStart <= t1;
  const bandX = bandVisible ? x(Math.max(roundStart, t0)) : 0;
  const plotRight = chartPad.left + chartInnerWidth;
  const futureReachUp = Math.min(
    chartInnerHeight * FUTURE_BEAM_REACH_FRAC,
    headY - chartPad.top,
  );
  const futureReachDown = Math.min(
    chartInnerHeight * FUTURE_BEAM_REACH_FRAC,
    baseline - headY,
  );

  // Live price pill in the right gutter, sized the same way as the lobby
  // chart's — the gutter width minus a margin.
  const pillW = chartPad.right - 8;
  const pillX = chartWidth - pillW - 2;

  // Hover crosshair: time + price at the cursor, like the lobby chart's scrub.
  // The forward-space region clamps to the live point, matching the lobby
  // chart; the crosshair hides only in the price-zoom gutter.
  const scrub = (() => {
    if (hoverX === null) return null;
    if (hoverX > chartPad.left + chartInnerWidth) return null;
    const cx = clamp(hoverX, chartPad.left, chartDataRight);
    const t = t0 + ((cx - chartPad.left) / chartDataWidth) * viewMs;
    const p = valueAt(visible, t);
    if (p === null) return null;
    return { x: cx, y: y(clamp(p, low, high)), t, p };
  })();

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverX(((event.clientX - rect.left) / rect.width) * chartWidth);
  };

  return (
    <div
      ref={containerRef}
      onDoubleClick={() => {
        viewRef.current = windowMs;
        priceScaleRef.current = 1;
        setZoomMs(windowMs);
        setPriceScale(1);
      }}
      title="Scroll the plot to zoom time; scroll the price axis to zoom price; double-click to reset"
      className="price-chart rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2"
    >
      <svg
        // A fresh round (or settling) replays the reveal sweep and the head's pop.
        key={`${roundStart ?? "none"}-${frozen}`}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-auto w-full"
        role="img"
        aria-label={`BTC/USD price, last ${spanLabel(viewMs)}, price scale ${priceScale.toFixed(1)} times fitted range`}
        onPointerMove={pointerMove}
        onPointerDown={pointerMove}
        onPointerLeave={() => setHoverX(null)}
        onPointerCancel={() => setHoverX(null)}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          {/* Line fades in from the left — older samples read as dimmer, the head as brightest. */}
          <linearGradient id={`${uid}-stroke`} gradientUnits="userSpaceOnUse" x1={xs[0]} x2={headX} y1="0" y2="0">
            <stop offset="0" stopColor={stroke} stopOpacity=".25" />
            <stop offset=".6" stopColor={stroke} stopOpacity=".9" />
            <stop offset="1" stopColor={stroke} stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`${uid}-band`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--brand)" stopOpacity=".16" />
            <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-cone-up`} gradientUnits="userSpaceOnUse" x1={headX} x2={plotRight} y1="0" y2="0">
            <stop offset="0" stopColor="var(--positive)" stopOpacity=".2" />
            <stop offset="1" stopColor="var(--positive)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-cone-down`} gradientUnits="userSpaceOnUse" x1={headX} x2={plotRight} y1="0" y2="0">
            <stop offset="0" stopColor="var(--negative)" stopOpacity=".2" />
            <stop offset="1" stopColor="var(--negative)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-now`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={chartPad.top} y2={baseline}>
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0" />
            <stop offset=".5" stopColor="var(--brand)" stopOpacity=".5" />
            <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}-aura`}>
            <stop offset="0" stopColor={stroke} stopOpacity=".4" />
            <stop offset=".5" stopColor={stroke} stopOpacity=".12" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-orb`} cx=".38" cy=".35" r=".7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset=".45" stopColor={stroke} />
            <stop offset="1" stopColor={stroke} stopOpacity=".65" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        <g className="mc-stars" aria-hidden="true">
          {STARS.map((star, i) => (
            <circle
              key={i}
              className={`mc-star tone-${star.tone}`}
              cx={chartPad.left + star.fx * chartInnerWidth}
              cy={chartPad.top + star.fy * chartInnerHeight}
              r={star.r}
              style={{ animationDuration: `${star.dur}s`, animationDelay: `${star.delay}s` }}
            />
          ))}
        </g>

        {/* Zoom levels, in the strip above the plot opposite `settled` */}
        <text x={chartPad.left} y={chartPad.top - 9} fill="var(--muted)" fontSize={isCompact ? 14 : 11}>
          {spanLabel(viewMs)} · price{" "}
          {priceScale === 1 ? "auto" : `${priceScale.toFixed(1)}×`}
        </text>

        {/* Gridlines + price axis. Forward space keeps labels clear of the live
            point; a label within 14px of the live pill is dropped. */}
        <g className="mc-grid">
          {gridValues.map((value, i) => {
            const gy = y(value);
            const nearPill = Math.abs(gy - headY) < 14;
            return (
              <g key={i} style={{ "--i": i } as React.CSSProperties}>
                <line
                  x1={chartPad.left}
                  x2={chartPad.left + chartInnerWidth}
                  y1={gy}
                  y2={gy}
                  stroke="var(--chart-grid)"
                />
                {!nearPill && (
                  <text
                    x={chartPad.left + chartInnerWidth + PRICE_AXIS_GAP}
                    y={gy + 4}
                    fill="var(--muted)"
                    fontSize={isCompact ? 14 : 12}
                  >
                    {axisLabel(value, visibleSpan)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Time axis: a minor mark per subdivision, a clock time per major tick */}
        <line
          x1={chartPad.left}
          x2={chartPad.left + chartInnerWidth}
          y1={baseline}
          y2={baseline}
          stroke="var(--chart-axis)"
        />
        <g className="mc-ticks">
          {ticks.map((t) => {
            const tx = x(t);
            // A label centred on the first tick can hang off the viewBox.
            const labelled = t % labelEvery === 0 && tx > chartPad.left + 22 && tx < plotRight - 22;
            return (
              <g key={t}>
                {labelled && (
                  <line
                    x1={tx}
                    x2={tx}
                    y1={chartPad.top}
                    y2={baseline}
                    stroke="var(--chart-grid)"
                  />
                )}
                <line
                  x1={tx}
                  x2={tx}
                  y1={baseline}
                  y2={baseline + (labelled ? 10 : 6)}
                  stroke={labelled ? "var(--muted)" : "var(--line-strong)"}
                />
                {labelled && (
                  <text
                    x={tx}
                    y={baseline + 27}
                    fill="var(--muted)"
                    fontSize={isCompact ? 13 : 10}
                    textAnchor="middle"
                  >
                    {clockLabel(t)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* The live round, shaded from the moment it started */}
        {bandVisible && (
          <>
            <rect
              x={bandX}
              y={chartPad.top}
              width={Math.max(0, chartDataRight - bandX)}
              height={chartInnerHeight}
              fill={`url(#${uid}-band)`}
            />
            {/* Only once the start itself is in view. */}
            {roundStart > t0 && (
                <line
                  x1={bandX}
                  x2={bandX}
                  y1={chartPad.top}
                  y2={baseline}
                  stroke="var(--chart-accent)"
                  strokeDasharray="3 3"
                  style={{ filter: `drop-shadow(0 0 3px var(--chart-accent))` }}
                />
              )}
            {!frozen ? (
              <g className="pc-chip is-live" transform={`translate(${chartDataRight - 78}, ${chartPad.top + 4})`}>
                <rect width="74" height="18" rx="9" />
                <circle cx="11" cy="9" r="3" />
                <text x="20" y="13">LIVE ROUND</text>
              </g>
            ) : null}
          </>
        )}

        {/* Future time remains on the axis even without prices. The live point
            projects a compact up/down possibility beam into that empty span. */}
        {!frozen && (
          <>
            <g className="mc-future" style={{ transformOrigin: `${headX}px ${headY}px` }}>
              <path d={`M${headX},${headY}L${plotRight},${headY - futureReachUp}L${plotRight},${headY}Z`} fill={`url(#${uid}-cone-up)`} />
              <path d={`M${headX},${headY}L${plotRight},${headY + futureReachDown}L${plotRight},${headY}Z`} fill={`url(#${uid}-cone-down)`} />
              {FUTURE_RAYS.map((k) => (
                <line
                  key={k}
                  className={`mc-ray ${k < 0 ? "is-up" : "is-down"}`}
                  x1={headX}
                  y1={headY}
                  x2={plotRight}
                  y2={headY + k * (k < 0 ? futureReachUp : futureReachDown)}
                />
              ))}
            </g>
            <line className="mc-now" x1={chartDataRight} x2={chartDataRight} y1={chartPad.top} y2={baseline} stroke={`url(#${uid}-now)`} />
          </>
        )}

        {/* Price line: a monotone curve, glowing, fading brighter toward the head */}
        <g className="mc-reveal">
          <path className="mc-area" d={area} fill={`url(#${uid}-fill)`} />
          <path className="market-chart-glow" d={lineD} fill="none" filter={`url(#${uid}-glow)`} style={{ stroke: `url(#${uid}-stroke)` }} />
          <path className="market-chart-line" d={lineD} fill="none" style={{ stroke: `url(#${uid}-stroke)` }} />
        </g>

        {/* Labeled entry-price line for the currently open position */}
        {openEntry && openEntry.t >= t0 && openEntry.t <= t1 && (() => {
          const entryColor = openEntry.side === "long" ? UP : DOWN;
          const ex = x(openEntry.t);
          const ey = y(clamp(openEntry.p, low, high));
          return (
            <g className="pc-entry-line" pointerEvents="none">
              <line
                x1={ex}
                x2={headX}
                y1={ey}
                y2={ey}
                stroke={entryColor}
                strokeDasharray="4 3"
                strokeWidth="1.5"
                opacity="0.75"
              />
              <rect
                x={chartPad.left + 2}
                y={ey - 9}
                width="54"
                height="16"
                rx="4"
                fill="var(--surface)"
                stroke={entryColor}
                strokeOpacity="0.6"
              />
              <text x={chartPad.left + 29} y={ey + 3} fill={entryColor} fontSize="9" fontWeight="600" textAnchor="middle">
                {axisLabel(openEntry.p, visibleSpan)}
              </text>
            </g>
          );
        })()}

        {/* Each directional entry, exit, and reversal, marked where it happened */}
        {trades.map((trade, i) => {
          if (trade.t < t0 || trade.t > t1) return null;
          const tx = x(trade.t);
          const ty = y(Math.min(Math.max(trade.p, low), high));
          const color = trade.side === "long" ? UP : DOWN;
          const action = trade.action ?? "entry";
          const isOther = trade.owner !== undefined && trade.owner !== "you";
          const dash = isOther ? "2 2" : undefined;
          return (
            <g key={i} style={{ filter: `drop-shadow(0 0 3px ${color})` }} opacity={isOther ? 0.85 : 1}>
              {action === "exit" ? (
                <rect
                  x={tx - 5}
                  y={ty - 5}
                  width="10"
                  height="10"
                  rx="2"
                  fill="var(--surface)"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={dash}
                />
              ) : action === "reverse" ? (
                <path d={`M ${tx} ${ty - 7} L ${tx + 7} ${ty} L ${tx} ${ty + 7} L ${tx - 7} ${ty} Z`} fill="var(--surface)" stroke={color} strokeWidth="2" strokeDasharray={dash} />
              ) : (
                <circle cx={tx} cy={ty} r="6" fill="var(--surface)" stroke={color} strokeWidth="2" strokeDasharray={dash} />
              )}
              <text
                x={tx}
                y={ty + 3.5}
                fill={color}
                fontSize="7.5"
                fontWeight="700"
                textAnchor="middle"
              >
                {action === "entry" ? (trade.side === "long" ? "L" : "S") : action === "exit" ? "×" : "R"}
              </text>
            </g>
          );
        })}

        {/* A transient P&L callout on the most recent closing trade only — a
            historical replay of every exit would clutter a multi-reverse round. */}
        {(() => {
          let latest: TradeMarker | null = null;
          for (const trade of trades) {
            if (trade.action !== "exit" && trade.action !== "reverse") continue;
            if (trade.pnl === undefined) continue;
            if (!latest || trade.t > latest.t) latest = trade;
          }
          if (!latest || latest.t < t0 || latest.t > t1) return null;
          const tx = x(latest.t);
          const ty = y(Math.min(Math.max(latest.p, low), high));
          const positive = (latest.pnl ?? 0) >= 0;
          return (
            <g
              key={`${latest.t}-${latest.action}`}
              className="pc-pnl-toast"
              transform={`translate(${tx}, ${ty - 18})`}
              pointerEvents="none"
            >
              <rect x="-26" y="-13" width="52" height="16" rx="8" fill={positive ? "var(--positive)" : "var(--negative)"} />
              <text x="0" y="-1.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--trade-contrast)">
                {positive ? "+" : "-"}${Math.abs(latest.pnl ?? 0).toFixed(2)}
              </text>
            </g>
          );
        })()}

        {/* Current price: a pulsing orb while live, a plain dot once settled */}
        <g transform={`translate(${headX}, ${headY})`}>
          {!frozen && <circle className="mc-aura" r="46" fill={`url(#${uid}-aura)`} />}
          <g className={frozen ? undefined : "mc-head-pop"}>
            {!frozen && <circle className="mc-shock" r="5" style={{ stroke }} />}
            {!frozen && Array.from({ length: 4 }, (_, i) => (
              <circle key={i} className="mc-spark" r={1.5 - i * 0.2} style={{ fill: stroke, animationDelay: `${(i * 1.4) / 4}s` }} />
            ))}
            {!frozen && <circle className="mc-halo" r="9" />}
            {!frozen && <circle className="market-chart-ping" r="5" style={{ fill: stroke }} />}
            {!frozen && flash.key > 0 && <circle key={flash.key} className={`market-chart-ripple is-${flash.dir}`} r="5" />}
            <circle className="mc-orb" r="4.5" fill={`url(#${uid}-orb)`} />
          </g>
        </g>

        {/* Live price pill in the right gutter */}
        <line className="market-chart-live" x1={headX} x2={chartWidth - pillW - 4} y1={headY} y2={headY} style={{ stroke }} />
        <g transform={`translate(${pillX}, ${clamp(headY, chartPad.top, baseline) - 11})`}>
          <g className="mc-pill-in">
            <rect className="market-chart-pill" width={pillW} height="22" rx="11" style={{ fill: stroke }} />
            {flash.key > 0 && <rect key={flash.key} className={`market-chart-pill-flash is-${flash.dir}`} width={pillW} height="22" rx="11" />}
            <text className="market-chart-pill-text" x={pillW / 2} y="15" textAnchor="middle">{axisLabel(last.p, visibleSpan)}</text>
          </g>
        </g>

        {frozen && (
          <g className="pc-chip is-settled" transform={`translate(${chartDataRight - 64}, ${chartPad.top - 25})`}>
            <rect width="64" height="16" rx="8" />
            <text x="10" y="11">SETTLED</text>
          </g>
        )}

        {/* Hover crosshair: time + price at the cursor, vs. the window's open */}
        {scrub && (() => {
          const delta = scrub.p - open;
          const tipW = 112;
          const tipX = clamp(scrub.x - tipW / 2, chartPad.left, chartDataRight - tipW);
          return (
            <g className="market-chart-scrub" pointerEvents="none">
              <line x1={scrub.x} x2={scrub.x} y1={chartPad.top} y2={baseline} />
              <circle cx={scrub.x} cy={scrub.y} r="4" className="mc-scrub-dot" style={{ fill: stroke }} />
              <g transform={`translate(${tipX}, ${chartPad.top - 24})`}>
                <rect className="market-chart-tip" width={tipW} height="18" rx="9" />
                <text className="market-chart-tip-text" x="9" y="12.5">{clockLabel(scrub.t)}</text>
                <text className={`market-chart-tip-text ${delta >= 0 ? "change-up" : "change-down"}`} x={tipW - 9} y="12.5" textAnchor="end">
                  {delta >= 0 ? "+" : "−"}{axisLabel(Math.abs(delta), visibleSpan)}
                </text>
              </g>
            </g>
          );
        })()}

        {/* A transparent hit area gives the price-axis gesture a visual cursor
            and a focused tooltip without obscuring its labels. */}
        <rect
          x={chartPad.left + chartInnerWidth}
          y={0}
          width={chartPad.right}
          height={chartHeight}
          fill="transparent"
          style={{ cursor: "ns-resize" }}
        >
          <title>Scroll to zoom the price axis</title>
        </rect>
      </svg>
    </div>
  );
}
