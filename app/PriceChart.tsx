"use client";

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
};

const W = 880;
const H = 400;
const PAD = { top: 20, right: 78, bottom: 44, left: 12 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const UP = "#10b981";
const DOWN = "#f43f5e";

const TICK_MS = 5000; // a mark every 5s
const LABEL_MS = 10000; // an exact time every 10s
const MIN_LABEL_GAP = 42; // px between clock labels before thinning

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

export default function PriceChart({
  points,
  predictions = [],
  roundStart = null,
  frozen = false,
}: Props) {
  if (points.length < 2) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-neutral-200 bg-white text-sm text-neutral-400">
        Waiting for price data…
      </div>
    );
  }

  const t0 = points[0].t;
  const t1 = Math.max(points[points.length - 1].t, t0 + 1);

  const prices = points.map((point) => point.p);
  const rawLow = Math.min(...prices);
  const rawHigh = Math.max(...prices);
  // Tight padding: the visible range tracks the actual swing, so small moves
  // read as real peaks and dips instead of a near-flat line.
  const span = rawHigh - rawLow || rawHigh * 0.0002;
  const low = rawLow - span * 0.06;
  const high = rawHigh + span * 0.06;
  const visibleSpan = high - low;

  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * INNER_W;
  const y = (p: number) => PAD.top + ((high - p) / (high - low)) * INNER_H;

  const line = points.map((pt) => `${x(pt.t)},${y(pt.p)}`).join(" ");
  const baseline = PAD.top + INNER_H;
  const area = `M ${x(t0)},${baseline} L ${line.replaceAll(" ", " L ")} L ${x(
    points[points.length - 1].t,
  )},${baseline} Z`;

  const last = points[points.length - 1];
  const rising = last.p >= points[0].p;
  const stroke = rising ? UP : DOWN;
  const gridValues = [high, (high + low) / 2, low];

  // Ticks land on wall-clock 5s boundaries, so the labels read as round times.
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / TICK_MS) * TICK_MS; t <= t1; t += TICK_MS) {
    ticks.push(t);
  }
  // A wider window would collide the 10s labels, so thin them to whatever
  // multiple of 10s still fits.
  const pxPerLabel = (LABEL_MS / (t1 - t0)) * INNER_W;
  const labelEvery =
    LABEL_MS * Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, pxPerLabel)));

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-2">
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
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + INNER_W}
              y1={y(value)}
              y2={y(value)}
              stroke="#f1f1f1"
            />
            <text
              x={PAD.left + INNER_W + 8}
              y={y(value) + 4}
              fill="#a3a3a3"
              fontSize="12"
            >
              {axisLabel(value, visibleSpan)}
            </text>
          </g>
        ))}

        {/* Time axis: a mark every 5s, an exact clock time every 10s */}
        <line
          x1={PAD.left}
          x2={PAD.left + INNER_W}
          y1={baseline}
          y2={baseline}
          stroke="#e5e5e5"
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
                  stroke="#f7f7f7"
                />
              )}
              <line
                x1={tx}
                x2={tx}
                y1={baseline}
                y2={baseline + (labelled ? 8 : 5)}
                stroke={labelled ? "#a3a3a3" : "#d4d4d4"}
              />
              {labelled && (
                <text
                  x={tx}
                  y={baseline + 21}
                  fill="#a3a3a3"
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
        {roundStart !== null && roundStart > t0 && (
          <>
            <rect
              x={x(roundStart)}
              y={PAD.top}
              width={Math.max(0, PAD.left + INNER_W - x(roundStart))}
              height={INNER_H}
              fill="#6366f1"
              fillOpacity="0.05"
            />
            {/* The second lock marker already draws this edge; skip the double line. */}
            {!predictions.some(
              (p) => p.at != null && Math.abs(p.at - roundStart) < 750,
            ) && (
              <line
                x1={x(roundStart)}
                x2={x(roundStart)}
                y1={PAD.top}
                y2={baseline}
                stroke="#a5b4fc"
                strokeDasharray="3 3"
              />
            )}
            <text
              x={PAD.left + INNER_W - 4}
              y={PAD.top + 12}
              fill="#818cf8"
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
            fill="#a3a3a3"
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
