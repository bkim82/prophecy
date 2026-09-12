"use client";

import { useEffect, useRef, useState } from "react";

import {
  MIN_WINDOW_MS,
  WINDOW_MS,
  X_INTERVALS,
  X_MINOR_PER_INTERVAL,
  Y_INTERVALS,
} from "./feedConfig";
import type { PricePoint } from "./usePriceFeed";

export type PredictionLine = {
  label: string;
  value: number;
  color: string;
  /** When the player locked in — drawn as a vertical marker. */
  at?: number | null;
};

export type TradeMarker = {
  t: number;
  p: number;
  side: "long" | "short";
  action?: "entry" | "exit" | "reverse";
};

type Props = {
  points: PricePoint[];
  predictions?: PredictionLine[];
  trades?: TradeMarker[];
  roundStart?: number | null;
  frozen?: boolean;
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
const PAD = { top: 20, right: 78, bottom: 44, left: 12 };

const UP = "var(--chart-up)";
const DOWN = "var(--chart-down)";

const MIN_LABEL_GAP = 42; // px between clock labels before thinning

// Wheel zoom. Multiplicative, so a notch feels the same at either end of the
// range: ~1.16x per 100px notch, ~5 notches across the full 1min→30s span.
const ZOOM_RATE = 0.0015;
// Price zoom starts at the data-fitting range and only expands from there. A
// generous ceiling lets an off-screen prediction be brought into view without
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

export default function PriceChart({
  points,
  predictions = [],
  trades = [],
  roundStart = null,
  frozen = false,
  now,
  windowMs = WINDOW_MS,
  minWindowMs = MIN_WINDOW_MS,
  xIntervals = X_INTERVALS,
  yIntervals = Y_INTERVALS,
  xMinorPerInterval = X_MINOR_PER_INTERVAL,
}: Props) {
  // Zoom is a view concern, so it lives here rather than being plumbed through
  // every caller. Time and price remain independent axes.
  const [zoomMs, setZoomMs] = useState(windowMs);
  const [priceScale, setPriceScale] = useState(1);
  const [isCompact, setIsCompact] = useState(false);
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
    ? { top: 28, right: 92, bottom: 62, left: 18 }
    : PAD;
  const chartInnerWidth = chartWidth - chartPad.left - chartPad.right;
  const chartInnerHeight = chartHeight - chartPad.top - chartPad.bottom;

  // Derived rather than corrected in an effect, so a windowMs change takes
  // effect on the same frame it arrives.
  const viewMs = clamp(zoomMs, minWindowMs, windowMs);
  const viewRef = useRef(viewMs);
  viewRef.current = viewMs;
  const priceScaleRef = useRef(priceScale);
  priceScaleRef.current = priceScale;

  const lastSample = points[points.length - 1];

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
        className="flex h-[clamp(280px,75vw,400px)] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--muted-dim)]"
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

  const x = (t: number) => chartPad.left + ((t - t0) / viewMs) * chartInnerWidth;
  const y = (p: number) => chartPad.top + ((high - p) / visibleSpan) * chartInnerHeight;

  const line = visible.map((pt) => `${x(pt.t)},${y(pt.p)}`).join(" ");
  const baseline = chartPad.top + chartInnerHeight;
  const last = visible[visible.length - 1];
  // Keep coincident prediction levels legible. Two players can intentionally
  // choose the same price, so a shared y coordinate would hide whichever line
  // is rendered first. Center the lines around the true level and stack their
  // labels so the chart still communicates both predictions.
  const predictionSlots = predictions.map((prediction, index) => {
    const peerCount = predictions.filter(
      (peer) => peer.value === prediction.value,
    ).length;
    const slot = predictions
      .slice(0, index)
      .filter((peer) => peer.value === prediction.value).length;
    return {
      offset: peerCount > 1 ? (slot - (peerCount - 1) / 2) * 4 : 0,
      labelOffset: peerCount > 1 ? slot * 14 : 0,
    };
  });
  const area = `M ${x(visible[0].t)},${baseline} L ${line.replaceAll(
    " ",
    " L ",
  )} L ${x(last.t)},${baseline} Z`;

  // Compare the latest value with the value at the left edge of the chart.
  const stroke = last.p >= visible[0].p ? UP : DOWN;

  const gridValues = Array.from(
    { length: yIntervals + 1 },
    (_, i) => high - (visibleSpan * i) / yIntervals,
  );

  // Ticks land on wall-clock boundaries of a round step, so every label reads as
  // a real time and the spacing holds as the window slides.
  const majorMs = niceStep(viewMs / Math.max(1, xIntervals));
  const minorMs = majorMs / Math.max(1, xMinorPerInterval);
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / minorMs) * minorMs; t <= t1; t += minorMs) {
    ticks.push(t);
  }
  // A tighter xIntervals would collide the clock labels, so thin them to
  // whatever multiple of the major step still fits.
  const pxPerMajor = (majorMs / viewMs) * chartInnerWidth;
  const labelEvery =
    majorMs * Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, pxPerMajor)));

  const bandVisible = roundStart !== null && roundStart <= t1;
  const bandX = bandVisible ? x(Math.max(roundStart, t0)) : 0;

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
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2"
    >
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-auto w-full"
        role="img"
        aria-label={`BTC/USD price, last ${spanLabel(viewMs)}, price scale ${priceScale.toFixed(1)} times fitted range`}
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Zoom levels, in the strip above the plot opposite `settled` */}
        <text x={chartPad.left} y={chartPad.top - 9} fill="var(--muted)" fontSize={isCompact ? 14 : 11}>
          {spanLabel(viewMs)} · price{" "}
          {priceScale === 1 ? "auto" : `${priceScale.toFixed(1)}×`}
        </text>

        {/* Gridlines + price axis */}
        {gridValues.map((value, i) => (
          <g key={i}>
            <line
              x1={chartPad.left}
              x2={chartPad.left + chartInnerWidth}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--chart-grid)"
            />
            <text
              x={chartPad.left + chartInnerWidth + 8}
              y={y(value) + 4}
              fill="var(--muted)"
              fontSize={isCompact ? 14 : 12}
            >
              {axisLabel(value, visibleSpan)}
            </text>
          </g>
        ))}

        {/* Time axis: a minor mark per subdivision, a clock time per major tick */}
        <line
          x1={chartPad.left}
          x2={chartPad.left + chartInnerWidth}
          y1={baseline}
          y2={baseline}
          stroke="var(--chart-axis)"
        />
        {ticks.map((t) => {
          const tx = x(t);
          // A label centred on the first tick can hang off the viewBox.
          const labelled = t % labelEvery === 0 && tx > 22;
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

        {/* The locked round, shaded from the moment both players locked in */}
        {bandVisible && (
          <>
            <rect
              x={bandX}
              y={chartPad.top}
              width={Math.max(0, chartPad.left + chartInnerWidth - bandX)}
              height={chartInnerHeight}
              fill="var(--line-strong)"
              fillOpacity="0.08"
            />
            {/* Only once the start itself is in view, and only if a lock marker
                isn't already drawing that same edge. */}
            {roundStart > t0 &&
              !predictions.some(
                (p) => p.at != null && Math.abs(p.at - roundStart) < 750,
              ) && (
                <line
                  x1={bandX}
                  x2={bandX}
                  y1={chartPad.top}
                  y2={baseline}
                  stroke="var(--accent)"
                  strokeDasharray="3 3"
                />
              )}
            <text
              x={chartPad.left + chartInnerWidth - 4}
              y={chartPad.top + 15}
              fill="var(--accent-strong)"
              fontSize={isCompact ? 14 : 11}
              textAnchor="end"
            >
              round
            </text>
          </>
        )}

        <path d={area} fill="url(#fill)" />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* The moment each player locked, marked where it happened */}
        {predictions.map((prediction, i) => {
          if (prediction.at == null) return null;
          if (prediction.at < t0 || prediction.at > t1) return null;
          const lx = x(prediction.at);
          // Locks seconds apart would stack their chips, so offset by slot.
          const chipY = chartPad.top + 4 + i * (isCompact ? 23 : 19);
          const chipW = isCompact ? 78 : 62;
          // Near the right edge, flip the chip to the left of the line.
          const flip = lx + 2 + chipW > chartPad.left + chartInnerWidth;
          const chipX = flip ? lx - 2 - chipW : lx + 2;
          return (
            <g key={`${prediction.label}-at`}>
              <line
                x1={lx}
                x2={lx}
                y1={chartPad.top}
                y2={baseline}
                stroke={prediction.color}
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.75"
              />
              <rect
                x={chipX}
                y={chipY}
                width={chipW}
                height={isCompact ? 20 : 16}
                rx="3"
                fill={prediction.color}
                fillOpacity="0.12"
              />
              <text
                x={chipX + 5}
                y={chipY + (isCompact ? 15 : 12)}
                fill={prediction.color}
                fontSize={isCompact ? 13 : 11}
                fontWeight="600"
              >
                {prediction.label} locked
              </text>
            </g>
          );
        })}

        {/* Prediction levels: a dashed line when in view, an edge chip when not */}
        {predictions.map((prediction, i) => {
          const inView = prediction.value >= low && prediction.value <= high;
          const py = inView
            ? y(prediction.value)
            : prediction.value > high
              ? chartPad.top + 6
              : baseline - 6;
          const slot = predictionSlots[i];
          const levelY = py + slot.offset;
          return (
            <g key={prediction.label}>
              {inView && (
                <line
                  x1={chartPad.left}
                  x2={chartPad.left + chartInnerWidth}
                  y1={levelY}
                  y2={levelY}
                  stroke={prediction.color}
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              )}
              <text
                x={chartPad.left + 6}
                y={py - 5 + slot.labelOffset}
                fill={prediction.color}
                fontSize={isCompact ? 14 : 12}
                fontWeight="500"
              >
                {prediction.label}
                {inView ? "" : prediction.value > high ? " ↑" : " ↓"}{" "}
                {axisLabel(prediction.value, visibleSpan)}
              </text>
            </g>
          );
        })}

        {/* Each directional entry, exit, and reversal, marked where it happened */}
        {trades.map((trade, i) => {
          if (trade.t < t0 || trade.t > t1) return null;
          const tx = x(trade.t);
          const ty = y(Math.min(Math.max(trade.p, low), high));
          const color = trade.side === "long" ? UP : DOWN;
          const action = trade.action ?? "entry";
          return (
            <g key={i}>
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
                />
              ) : action === "reverse" ? (
                <path d={`M ${tx} ${ty - 7} L ${tx + 7} ${ty} L ${tx} ${ty + 7} L ${tx - 7} ${ty} Z`} fill="var(--surface)" stroke={color} strokeWidth="2" />
              ) : (
                <circle cx={tx} cy={ty} r="6" fill="var(--surface)" stroke={color} strokeWidth="2" />
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

        {/* Current price marker */}
        <circle
          cx={x(last.t)}
          cy={y(last.p)}
          r="4"
          fill={stroke}
          className={
            frozen
              ? undefined
              : "animate-ping [transform-box:fill-box] origin-center"
          }
          opacity={frozen ? 1 : 0.45}
        />
        <circle cx={x(last.t)} cy={y(last.p)} r="3.5" fill={stroke} />

        {frozen && (
          <text
            x={chartPad.left + chartInnerWidth}
            y={chartPad.top - 9}
            fill="var(--muted)"
            fontSize={isCompact ? 14 : 11}
            textAnchor="end"
          >
            settled
          </text>
        )}

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
