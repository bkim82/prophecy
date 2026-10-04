import type { MarketCall } from "@/app/lib/mockPosts";

const toNumber = (price: string) => Number(price.replace(/,/g, ""));

// A price in the same style as the call's entry string ("67,240", "0.1240").
export function formatCallPrice(call: MarketCall, price: number): string {
  const decimals = call.entryPrice.split(".")[1]?.length ?? 0;
  return price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Leveraged return: price move × leverage, flipped for shorts, floored at
// −100% (the margin is gone at liquidation).
export function callRoi(call: MarketCall): number {
  const entry = toNumber(call.entryPrice);
  const move = (toNumber(call.currentPrice) - entry) / entry;
  return Math.max(-100, move * 100 * (call.leverage ?? 1) * (call.side === "SHORT" ? -1 : 1));
}

export const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;

// Isolated-margin liquidation with no maintenance buffer: a 1/leverage move
// against the position. Undefined for unlevered calls.
export function liquidationPrice(call: MarketCall): number | undefined {
  if (!call.leverage) return undefined;
  const entry = toNumber(call.entryPrice);
  return call.side === "LONG" ? entry * (1 - 1 / call.leverage) : entry * (1 + 1 / call.leverage);
}

// live = open; doom = open with price in the last 15% of track before doom.
export type CallState = "live" | "doom" | "fulfilled" | "broken" | "liquidated";

const DOOM_ZONE = 0.15;

export type CallTrack = {
  state: CallState;
  doom: number;
  doomKind: "stop" | "liq";
  destiny: number;
  cast: number;
  now: number;
  // Positions along the track, 0 = doom end, 1 = destiny (✦).
  castAt: number;
  nowAt: number;
  // How far price is from doom, as % of price ("0.3% to liq").
  doomDistancePct: number;
  // Fraction of the call window left (time ring); 1 once resolved.
  timeLeft: number;
};

function minutes(expiresIn: string): number {
  const h = /(\d+)h/.exec(expiresIn);
  const m = /(\d+)m/.exec(expiresIn);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

// Every call is drawn on one horizontal track: doom (stop or liquidation,
// whichever the move hits first) on the left, destiny (target) on the right.
export function callTrack(call: MarketCall): CallTrack {
  const cast = toNumber(call.entryPrice);
  const now = toNumber(call.currentPrice);
  const destiny = call.target;
  const exits = [
    call.stop !== undefined ? { price: call.stop, kind: "stop" as const } : null,
    liquidationPrice(call) !== undefined ? { price: liquidationPrice(call)!, kind: "liq" as const } : null,
  ].filter((exit) => exit !== null);
  // No stop and no leverage: mirror the target distance so the track still has a left end.
  const first = exits.sort((a, b) => Math.abs(a.price - cast) - Math.abs(b.price - cast))[0] ?? { price: cast - (destiny - cast), kind: "stop" as const };
  const at = (price: number) => Math.min(1, Math.max(0, (price - first.price) / (destiny - first.price)));

  const status = call.outcome?.status;
  const state: CallState =
    status === "won" ? "fulfilled"
    : status === "liquidated" ? "liquidated"
    : status ? "broken"
    : at(now) < DOOM_ZONE ? "doom"
    : "live";
  const window = call.windowMin && call.expiresIn ? minutes(call.expiresIn) / call.windowMin : 1;

  return {
    state,
    doom: first.price,
    doomKind: first.kind,
    destiny,
    cast,
    now,
    castAt: at(cast),
    nowAt: state === "fulfilled" ? 1 : state === "liquidated" ? 0 : at(now),
    doomDistancePct: (Math.abs(now - first.price) / now) * 100,
    timeLeft: status ? 1 : Math.min(1, Math.max(0, window)),
  };
}
