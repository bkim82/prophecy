import {
  pulseIsLiquidated,
  pulseLiquidationPrice,
  pulsePositionPnl,
  type PulsePosition,
  type PulseSide,
} from "@/lib/pulse";

/**
 * Pulse tutorial, scripted lessons 1–5: pure data + math, no React.
 *
 * Every lesson replays the same price path (as % moves from the entry price,
 * anchored to the live BTC price when the lesson opens), so every player sees
 * the same lesson. Time is "virtual": the round is always 60 seconds on the
 * clock, played back in `realMs`.
 */

export const PRACTICE_BALANCE = 1000;
export const LESSON_STAKE = 100;
export const ROUND_S = 60;
/** Seconds of price history shown before the round starts. */
export const LEAD_IN_S = 15;
/** Virtual seconds between samples: 240 per round. */
export const SAMPLE_S = 0.25;
/** Used only if the live feed hasn't produced a price yet. */
export const FALLBACK_ANCHOR = 100_000;

export type LessonId = "long" | "short" | "leverage" | "liquidation" | "close";

/** [virtual second, % move from the entry price]. Must span −LEAD_IN_S..ROUND_S. */
type Keyframe = readonly [number, number];

export type LessonDef = {
  id: LessonId;
  /** Stepper label. */
  step: string;
  realMs: number;
  /** Sides the player may pick; one entry means it's fixed. */
  sides: readonly PulseSide[];
  leverage:
    | { kind: "fixed"; value: number }
    | { kind: "slider"; min: number; max: number; initial: number }
    | { kind: "choice"; options: readonly number[] };
  /** Lesson 5 is the first that lets you close before the bell. */
  canClose: boolean;
  /** Draws the liquidation line/zone (lesson 4 onward). */
  showLiquidation: boolean;
  keys: readonly Keyframe[];
  /** Wiggle amplitude in %, so the path reads as a market rather than a ruler. */
  noisePct: number;
  seed: number;
  /** Extra % levels the y-axis must include (e.g. liquidation lines). */
  includePct?: readonly number[];
};

export const LESSONS: readonly LessonDef[] = [
  {
    id: "long",
    step: "Long",
    realMs: 10_000,
    sides: ["long"],
    leverage: { kind: "fixed", value: 1 },
    canClose: false,
    showLiquidation: false,
    keys: [[-15, -0.55], [-9, -0.25], [-4, -0.32], [0, 0], [9, 0.5], [17, 0.28], [29, 1.25], [38, 1.55], [44, 1.4], [51, 2.0], [60, 2.4]],
    noisePct: 0.05,
    seed: 11,
  },
  {
    id: "short",
    step: "Short",
    realMs: 10_000,
    sides: ["long", "short"],
    leverage: { kind: "fixed", value: 1 },
    canClose: false,
    showLiquidation: false,
    keys: [[-15, 1.05], [-10, 0.7], [-6, 0.78], [0, 0], [8, -0.6], [15, -0.32], [25, -1.2], [34, -0.95], [45, -1.85], [52, -1.7], [60, -2.2]],
    noisePct: 0.05,
    seed: 23,
  },
  {
    id: "leverage",
    step: "Leverage",
    realMs: 10_000,
    sides: ["long"],
    leverage: { kind: "slider", min: 1, max: 20, initial: 5 },
    canClose: false,
    showLiquidation: false,
    keys: [[-15, -0.2], [-8, 0.05], [-3, -0.1], [0, 0], [10, 0.3], [20, -0.18], [31, 0.48], [44, 0.68], [52, 0.6], [60, 1.0]],
    noisePct: 0.035,
    seed: 37,
  },
  {
    id: "liquidation",
    step: "Liquidation",
    realMs: 10_000,
    sides: ["long"],
    leverage: { kind: "choice", options: [5, 10, 15, 25] },
    canClose: false,
    showLiquidation: true,
    // Dips ~4.6% then finishes +3%: past 25×'s 4% liquidation, short of 15×'s 6.7%.
    keys: [[-15, -1.4], [-9, -0.8], [-4, -0.6], [0, 0], [6, 0.4], [12, -1.5], [18, -3.4], [23, -4.6], [27, -3.9], [33, -2.0], [40, 0.2], [48, 1.8], [60, 3.0]],
    noisePct: 0.05,
    seed: 41,
    includePct: [-100 / 15],
  },
  {
    id: "close",
    step: "Closing",
    // A touch slower than lessons 1–4: this one asks for a reaction.
    realMs: 15_000,
    sides: ["long"],
    leverage: { kind: "fixed", value: 10 },
    canClose: true,
    showLiquidation: false,
    // Climbs, stalls with a lower high, then rolls over below the entry.
    keys: [[-15, -0.3], [-8, -0.1], [-3, -0.2], [0, 0], [8, 0.6], [16, 1.2], [22, 1.9], [26, 2.2], [30, 2.0], [34, 2.3], [38, 1.9], [42, 2.05], [46, 1.3], [52, 0.4], [56, -0.3], [60, -0.6]],
    noisePct: 0.05,
    seed: 53,
  },
];

export const LIVE_STEP = "Live round";
export const STEP_LABELS = [...LESSONS.map((lesson) => lesson.step), LIVE_STEP];

export type PathPoint = { s: number; p: number };

/** Seeded PRNG (mulberry32), so the wiggles are the same for every player. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function interpolate(keys: readonly Keyframe[], s: number) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [s1, v1] = keys[i];
    if (s <= s1) {
      const [s0, v0] = keys[i - 1];
      return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * % move from entry at each sample, −LEAD_IN_S..ROUND_S. The wiggle fades to
 * zero at the start and the bell, so the entry is exactly the anchor and the
 * final move is exactly the last keyframe — debrief numbers come out clean.
 */
export function lessonPathPct(def: LessonDef): { s: number; pct: number }[] {
  const rand = seeded(def.seed);
  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const out: { s: number; pct: number }[] = [];
  const steps = Math.round((LEAD_IN_S + ROUND_S) / SAMPLE_S);
  for (let i = 0; i <= steps; i++) {
    const s = -LEAD_IN_S + i * SAMPLE_S;
    const envelope = s <= 0 ? Math.min(1, -s / 3) : Math.min(1, s / 4, (ROUND_S - s) / 4);
    const wiggle =
      0.55 * Math.sin((2 * Math.PI * s) / 6.7 + phase1) +
      0.3 * Math.sin((2 * Math.PI * s) / 2.3 + phase2) +
      0.3 * (rand() - 0.5);
    out.push({ s, pct: interpolate(def.keys, s) + def.noisePct * wiggle * envelope });
  }
  return out;
}

export const toPrices = (pcts: { s: number; pct: number }[], anchor: number): PathPoint[] =>
  pcts.map(({ s, pct }) => ({ s, p: anchor * (1 + pct / 100) }));

/** Index of the sample at virtual second `s` (clamped into the path). */
export const sampleIndex = (s: number) =>
  Math.max(0, Math.min(Math.round((LEAD_IN_S + ROUND_S) / SAMPLE_S), Math.round((s + LEAD_IN_S) / SAMPLE_S)));

export const ENTRY_INDEX = sampleIndex(0);
export const BELL_INDEX = sampleIndex(ROUND_S);

/** Fixed y-range for the whole lesson, so the axis never rescales mid-round. */
export function lessonDomain(path: PathPoint[], anchor: number, includePct: readonly number[] = []) {
  const prices = [...path.map((point) => point.p), ...includePct.map((pct) => anchor * (1 + pct / 100))];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const pad = (high - low) * 0.1 || anchor * 0.001;
  return { low: low - pad, high: high + pad };
}

export const lessonPosition = (side: PulseSide, entryPrice: number, leverage: number): PulsePosition => ({
  id: "lesson",
  side,
  entryPrice,
  stake: LESSON_STAKE,
  leverage,
});

export type ExitKind = "bell" | "closed" | "liquidated";
export type LessonExit = { s: number; p: number; pnl: number; kind: ExitKind };

/** First sample after entry where the position is wiped out, if any. */
export function liquidationIn(path: PathPoint[], position: PulsePosition, fromIndex: number, toIndex: number): LessonExit | null {
  for (let i = Math.max(fromIndex, ENTRY_INDEX + 1); i <= toIndex; i++) {
    if (pulseIsLiquidated(position, path[i].p)) {
      return { s: path[i].s, p: pulseLiquidationPrice(position), pnl: -position.stake, kind: "liquidated" };
    }
  }
  return null;
}

/** How a trade held to the bell would have ended at this leverage. */
export function heldOutcome(path: PathPoint[], side: PulseSide, leverage: number): LessonExit {
  const position = lessonPosition(side, path[ENTRY_INDEX].p, leverage);
  const bell = path[BELL_INDEX];
  return liquidationIn(path, position, ENTRY_INDEX + 1, BELL_INDEX) ?? {
    s: bell.s,
    p: bell.p,
    pnl: pulsePositionPnl(position, bell.p),
    kind: "bell",
  };
}

/** The best P&L the trade touched during the round, and where. */
export function peakOf(path: PathPoint[], position: PulsePosition) {
  let best = { s: 0, p: position.entryPrice, pnl: 0 };
  for (let i = ENTRY_INDEX; i <= BELL_INDEX; i++) {
    const pnl = pulsePositionPnl(position, path[i].p);
    if (pnl > best.pnl) best = { s: path[i].s, p: path[i].p, pnl };
  }
  return best;
}

/** Signed % move from entry to `price`. */
export const movePct = (entry: number, price: number) => ((price - entry) / entry) * 100;

/** How far the price can move against you before liquidation, in %. */
export const liquidationDistancePct = (leverage: number) => 100 / leverage;

export type LessonOutcome = {
  lesson: LessonId;
  side: PulseSide;
  leverage: number;
  entry: number;
  exit: LessonExit;
  /** Price at the bell, whether or not the trade was still open. */
  bellPrice: number;
};
