"use client";

import type { PricePoint } from "./usePriceFeed";

export type PredictionLine = { label: string; value: number; color: string };

type Props = {
  points: PricePoint[];
  predictions?: PredictionLine[];
  roundStart?: number | null;
  frozen?: boolean;
};

const W = 880;
const H = 260;
const PAD = { top: 18, right: 74, bottom: 22, left: 10 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const UP = "#10b981";
const DOWN = "#f43f5e";

// Zoomed in far enough that a $5 move matters, so the labels need decimals.
const axisLabel = (n: number, span = Infinity) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: span < 25 ? 2 : 0,
    maximumFractionDigits: span < 25 ? 2 : 0,
  });

export default function PriceChart({
  points,
  predictions = [],
  roundStart = null,
  frozen = false,
}: Props) {
  if (points.length < 2) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-neutral-200 bg-white text-sm text-neutral-400">
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
            <line
              x1={x(roundStart)}
              x2={x(roundStart)}
              y1={PAD.top}
              y2={baseline}
              stroke="#a5b4fc"
              strokeDasharray="3 3"
            />
            <text
              x={x(roundStart) + 5}
              y={PAD.top + 11}
              fill="#818cf8"
              fontSize="11"
            >
              locked
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

        <text x={PAD.left} y={H - 6} fill="#a3a3a3" fontSize="11">
          {t1 - t0 < 90000
            ? `${Math.max(1, Math.round((t1 - t0) / 1000))}s ago`
            : `${Math.round((t1 - t0) / 60000)}m ago`}
        </text>
        <text
          x={PAD.left + INNER_W}
          y={H - 6}
          fill="#a3a3a3"
          fontSize="11"
          textAnchor="end"
        >
          {frozen ? "settled" : "now"}
        </text>
      </svg>
    </div>
  );
}
