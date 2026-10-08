import { pulseLiquidationPrice, pulsePositionPnl, type PulsePosition, type PulseSide } from "@/lib/pulse";
import type { PricePoint } from "@/app/usePriceFeed";

/**
 * Pulse tutorial, lesson 6 (live round): the practice bot's rules and the
 * coach's tips. Pure functions of real state — the bot trades the live tape
 * and the coach only comments on what the player's position is actually doing.
 */

export const LIVE_ROUND_SECONDS = 60;
export const LIVE_STARTING_CASH = 1000;
export const LIVE_DEFAULT_STAKE = 100;

export const BOT_STAKE = 250;
export const BOT_LEVERAGE = 100;
/** Momentum lookback for the bot's side pick. */
const BOT_LOOKBACK_MS = 8_000;
/** Bot takes profit once it has been up this share of its stake... */
const BOT_TAKE_SHARE = 0.06;
/** ...and the profit has slipped this far off its best (the lesson 5 rule). */
const BOT_GIVEBACK_SHARE = 0.4;
const BOT_STOP_SHARE = 0.08;
export const BOT_COOLDOWN_MS = 3_000;

export type BotMemory = {
  position: PulsePosition | null;
  /** Best P&L the open position has touched. */
  peakPnl: number;
  cooldownUntil: number;
};

export type BotAction =
  | { kind: "none" }
  | { kind: "enter"; side: PulseSide }
  | { kind: "close"; reason: "stall" | "stop" | "bell" };

/** Price at or just before `t` in the sampled series. */
function priceAt(points: PricePoint[], t: number) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].t <= t) return points[i].p;
  return points[0]?.p ?? null;
}

export function botDecide(memory: BotMemory, input: { price: number; points: PricePoint[]; now: number; secondsLeft: number }): BotAction {
  const { price, points, now, secondsLeft } = input;
  if (memory.position) {
    const pnl = pulsePositionPnl(memory.position, price);
    const stake = memory.position.stake;
    if (pnl > 0 && secondsLeft <= 5) return { kind: "close", reason: "bell" };
    if (memory.peakPnl >= stake * BOT_TAKE_SHARE && pnl > 0 && pnl <= memory.peakPnl * (1 - BOT_GIVEBACK_SHARE)) {
      return { kind: "close", reason: "stall" };
    }
    if (pnl <= -stake * BOT_STOP_SHARE) return { kind: "close", reason: "stop" };
    return { kind: "none" };
  }
  if (now < memory.cooldownUntil || secondsLeft <= 10) return { kind: "none" };
  const before = priceAt(points, now - BOT_LOOKBACK_MS);
  return { kind: "enter", side: before === null || price >= before ? "long" : "short" };
}

export type CoachTone = "info" | "good" | "warn";
export type CoachTip = { tone: CoachTone; text: string };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

/**
 * One tip at a time, most urgent first. The close-timing rules from lesson 5
 * are the backbone: stalled profit, near liquidation, final seconds.
 */
export function coachTip(input: {
  started: boolean;
  position: PulsePosition | null;
  price: number | null;
  peakPnl: number;
  secondsLeft: number;
  lastClosedPnl: number | null;
  liquidated: boolean;
}): CoachTip {
  const { started, position, price, peakPnl, secondsLeft, lastClosedPnl, liquidated } = input;
  if (!started) {
    return { tone: "info", text: "Pick Long or Short to start the clock. New to this? Try a $100 stake at 100×." };
  }
  if (position && price !== null) {
    const pnl = pulsePositionPnl(position, price);
    const stake = position.stake;
    if (pnl <= -stake * 0.5) {
      return {
        tone: "warn",
        text: `You've lost ${Math.round((-pnl / stake) * 100)}% of this stake and liquidation is at ${usd(pulseLiquidationPrice(position))}. Closing now keeps the rest.`,
      };
    }
    if (secondsLeft <= 10 && pnl > 0) {
      return { tone: "good", text: `${secondsLeft}s left and you're up ${signedUsd(pnl)}. Lock it in before the clock closes it for you.` };
    }
    const giveback = peakPnl - pnl;
    if (peakPnl >= stake * 0.05 && giveback >= Math.max(stake * 0.02, peakPnl * 0.35)) {
      return {
        tone: "warn",
        text: `Your profit peaked at ${signedUsd(peakPnl)} and has slipped to ${signedUsd(pnl)}. The move may be stalling, so this is a good moment to close.`,
      };
    }
    if (pnl > 0) {
      return { tone: "good", text: `You're up ${signedUsd(pnl)}. Let it run while the price keeps moving your way, and close if it stalls.` };
    }
    if (pnl < 0) {
      return {
        tone: "info",
        text: `It's moving against you (${signedUsd(pnl)}). Give it a moment, but close well before ${usd(pulseLiquidationPrice(position))}, where you'd be liquidated.`,
      };
    }
    return { tone: "info", text: "Trade open. Watch your P&L and close when the move stalls." };
  }
  if (liquidated) {
    return { tone: "warn", text: "Liquidated: that stake is gone. Lower leverage gives the price more room before it can wipe you out." };
  }
  if (secondsLeft <= 5) return { tone: "info", text: "Almost done. Sitting out is fine: no trade, no risk." };
  if (lastClosedPnl !== null && lastClosedPnl >= 0.005) {
    return { tone: "good", text: `Nice close, ${signedUsd(lastClosedPnl)} locked in. Wait for your next clear move, or sit out the rest.` };
  }
  if (lastClosedPnl !== null && Math.abs(lastClosedPnl) < 0.005) {
    return { tone: "info", text: "Closed flat: the price hadn't moved yet. Wait for a clearer move before picking a side again." };
  }
  if (lastClosedPnl !== null && lastClosedPnl < 0) {
    return { tone: "info", text: `Closed at ${signedUsd(lastClosedPnl)}. Small losses are part of the game. Waiting for a clearer move is a valid choice.` };
  }
  return { tone: "info", text: "You're flat. Pick a side whenever you see a move you like." };
}
