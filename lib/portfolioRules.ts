// Pure 24h Portfolio math — no DB import, so client pages can safely pull in
// the live unrealized-P&L preview and constants (mirrors lib/pulse.ts sitting
// next to the DB-touching lib/match.ts, and the retired lib/readingRules.ts).

export type PositionKind = "spot" | "leverage";
export type PositionSide = "long" | "short";

export const PORTFOLIO_SESSION_MS = 24 * 60 * 60 * 1000;
export const PORTFOLIO_LEVERAGE_OPTIONS = [1, 2, 3, 5] as const;
export const PORTFOLIO_MAX_STAKE = 1_000_000;

export const isPositionSide = (value: unknown): value is PositionSide =>
  value === "long" || value === "short";

export const isPositionKind = (value: unknown): value is PositionKind =>
  value === "spot" || value === "leverage";

export const isPortfolioLeverage = (value: number) =>
  (PORTFOLIO_LEVERAGE_OPTIONS as readonly number[]).includes(value);

export const sessionEndAt = (startAtMs: number) => startAtMs + PORTFOLIO_SESSION_MS;

/** Buying power still free to commit to a new position. */
export const availableCash = (startingBalance: number, committedCash: number, realizedPnl: number) =>
  startingBalance - committedCash + realizedPnl;

export const spotQtyForAmount = (amount: number, price: number) => amount / price;

/** Loss floored at the position's cost basis — you can't lose more than you paid. */
export function spotPnl(qty: number, entryPrice: number, exitPrice: number) {
  const raw = qty * (exitPrice - entryPrice);
  return Math.round(Math.max(raw, -(qty * entryPrice)));
}

/** Same stop-out shape as the retired readingPnl/pulsePositionPnl: a loss can never exceed the committed cash. */
export function leveragePnl(
  row: { committedCash: number; leverage: number; side: PositionSide; entryPrice: number },
  exitPrice: number,
) {
  const move =
    row.side === "long"
      ? (exitPrice - row.entryPrice) / row.entryPrice
      : (row.entryPrice - exitPrice) / row.entryPrice;
  const raw = row.committedCash * move * row.leverage;
  return Math.round(Math.max(raw, -row.committedCash));
}

export type PositionLike = {
  kind: PositionKind;
  qty: number | null;
  entryPrice: number;
  committedCash: number;
  leverage: number | null;
  side: PositionSide | null;
};

/** Dispatches to spotPnl/leveragePnl based on `kind` — the one function callers should reach for. */
export function positionPnl(position: PositionLike, exitPrice: number) {
  if (position.kind === "spot") {
    return spotPnl(position.qty ?? 0, position.entryPrice, exitPrice);
  }
  return leveragePnl(
    { committedCash: position.committedCash, leverage: position.leverage ?? 1, side: position.side ?? "long", entryPrice: position.entryPrice },
    exitPrice,
  );
}
