"use client";

import {
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

type Props = {
  points: PricePoint[];
  predictions?: PredictionLine[];
  roundStart?: number | null;
  frozen?: boolean;
  /** Wall clock driving the right edge; ticks so the window scrolls on its own. */
  now?: number;
  /** Axis divisions — defaults live in feedConfig. */
  windowMs?: number;
  xIntervals?: number;
  yIntervals?: number;
  xMinorPerInterval?: number;
};

const W = 880;
const H = 400;
const PAD = { top: 20, right: 78, bottom: 44, left: 12 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const UP = "#91b7d8";
const DOWN = "#a4adb9";

const MIN_LABEL_GAP = 42; // px between clock labels before thinning

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
  roundStart = null,
  frozen = false,
  now,
  windowMs = WINDOW_MS,
  xIntervals = X_INTERVALS,
  yIntervals = Y_INTERVALS,
  xMinorPerInterval = X_MINOR_PER_INTERVAL,
}: Props) {
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
  const t0 = t1 - windowMs;

  const visible = windowSlice(points, t0);

  if (visible.length < 2) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-[#2b3b4d] bg-[#131e2a] text-sm text-[#718195]">
        Waiting for price data…
      </div>
    );
  }

  const prices = visible.map((point) => point.p);
  const rawLow = Math.min(...prices);
  const rawHigh = Math.max(...prices);
  // Tight padding: the visible range tracks the actual swing, so small moves
  // read as real peaks and dips instead of a near-flat line.
  const span = rawHigh - rawLow || rawHigh * 0.0002;
  const low = rawLow - span * 0.06;
  const high = rawHigh + span * 0.06;
  const visibleSpan = high - low;

  const x = (t: number) => PAD.left + ((t - t0) / windowMs) * INNER_W;
  const y = (p: number) => PAD.top + ((high - p) / visibleSpan) * INNER_H;

  const line = visible.map((pt) => `${x(pt.t)},${y(pt.p)}`).join(" ");
  const baseline = PAD.top + INNER_H;
  const last = visible[visible.length - 1];
  const area = `M ${x(visible[0].t)},${baseline} L ${line.replaceAll(
    " ",
    " L ",
  )} L ${x(last.t)},${baseline} Z`;

  const rising = last.p >= visible[0].p;
  const stroke = rising ? UP : DOWN;

  const gridValues = Array.from(
    { length: yIntervals + 1 },
    (_, i) => high - (visibleSpan * i) / yIntervals,
  );

  // Ticks land on wall-clock boundaries of a round step, so every label reads as
  // a real time and the spacing holds as the window slides.
  const majorMs = niceStep(windowMs / Math.max(1, xIntervals));
  const minorMs = majorMs / Math.max(1, xMinorPerInterval);
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / minorMs) * minorMs; t <= t1; t += minorMs) {
    ticks.push(t);
  }
  // A tighter xIntervals would collide the clock labels, so thin them to
  // whatever multiple of the major step still fits.
  const pxPerMajor = (majorMs / windowMs) * INNER_W;
  const labelEvery =
    majorMs * Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, pxPerMajor)));

  const bandVisible = roundStart !== null && roundStart <= t1;
  const bandX = bandVisible ? x(Math.max(roundStart, t0)) : 0;

  return (
    <div className="rounded-xl border border-[#2b3b4d] bg-[#131e2a] p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="BTC/USD price, last few minutes"
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines + price axis */}
        {gridValues.map((value, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={PAD.left + INNER_W}
              y1={y(value)}
              y2={y(value)}
              stroke="#263646"
            />
            <text
              x={PAD.left + INNER_W + 8}
              y={y(value) + 4}
              fill="#8493a3"
              fontSize="12"
            >
              {axisLabel(value, visibleSpan)}
            </text>
          </g>
        ))}

        {/* Time axis: a minor mark per subdivision, a clock time per major tick */}
        <line
          x1={PAD.left}
          x2={PAD.left + INNER_W}
          y1={baseline}
          y2={baseline}
          stroke="#344658"
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
                  y1={PAD.top}
                  y2={baseline}
                  stroke="#263646"
                />
              )}
              <line
                x1={tx}
                x2={tx}
                y1={baseline}
                y2={baseline + (labelled ? 8 : 5)}
                stroke={labelled ? "#8493a3" : "#506173"}
              />
              {labelled && (
                <text
                  x={tx}
                  y={baseline + 21}
                  fill="#8493a3"
                  fontSize="10"
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
              y={PAD.top}
              width={Math.max(0, PAD.left + INNER_W - bandX)}
              height={INNER_H}
              fill="#6e89a4"
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
                  y1={PAD.top}
                  y2={baseline}
                  stroke="#7897b6"
                  strokeDasharray="3 3"
                />
              )}
            <text
              x={PAD.left + INNER_W - 4}
              y={PAD.top + 12}
              fill="#9ab5cf"
              fontSize="11"
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
          const chipY = PAD.top + 3 + i * 19;
          const chipW = 62;
          // Near the right edge, flip the chip to the left of the line.
          const flip = lx + 2 + chipW > PAD.left + INNER_W;
          const chipX = flip ? lx - 2 - chipW : lx + 2;
          return (
            <g key={`${prediction.label}-at`}>
              <line
                x1={lx}
                x2={lx}
                y1={PAD.top}
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
                height={16}
                rx="3"
                fill={prediction.color}
                fillOpacity="0.12"
              />
              <text
                x={chipX + 5}
                y={chipY + 12}
                fill={prediction.color}
                fontSize="11"
                fontWeight="600"
              >
                {prediction.label} locked
              </text>
            </g>
          );
        })}

        {/* Prediction levels: a dashed line when in view, an edge chip when not */}
        {predictions.map((prediction) => {
          const inView = prediction.value >= low && prediction.value <= high;
          const py = inView
            ? y(prediction.value)
            : prediction.value > high
              ? PAD.top + 6
              : baseline - 6;
          return (
            <g key={prediction.label}>
              {inView && (
                <line
                  x1={PAD.left}
                  x2={PAD.left + INNER_W}
                  y1={py}
                  y2={py}
                  stroke={prediction.color}
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
              )}
              <text
                x={PAD.left + 4}
                y={py - 5}
                fill={prediction.color}
                fontSize="12"
                fontWeight="500"
              >
                {prediction.label}
                {inView ? "" : prediction.value > high ? " ↑" : " ↓"}{" "}
                {axisLabel(prediction.value, visibleSpan)}
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
            x={PAD.left + INNER_W}
            y={PAD.top - 7}
            fill="#8493a3"
            fontSize="11"
            textAnchor="end"
          >
            settled
          </text>
        )}
      </svg>
    </div>
  );
}
