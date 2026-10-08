export type PulseSide = "long" | "short";

export type PulsePosition = {
  id: string;
  side: PulseSide;
  entryPrice: number;
  stake: number;
  leverage: number;
  /** Server ms when it filled; liquidation only counts trades from here on. Absent on rows from before liquidation existed. */
  openedAt?: number;
};

export const PULSE_STARTING_CASH = 100;
/** What the stake stepper's −/+ buttons move by. */
export const PULSE_STAKE_STEP = 25;
export const PULSE_LEVERAGE_OPTIONS = [100, 1000, 10000] as const;

/** Cash reserved by open positions. It is returned when a position closes. */
export function pulsePositionsStake(positions: PulsePosition[]) {
  return positions.reduce((total, position) => total + position.stake, 0);
}

/** Cash still available for new entries after realized P&L and open stakes. */
export function pulseAvailableCash(positions: PulsePosition[], realizedPnl: number) {
  return Math.max(0, PULSE_STARTING_CASH + realizedPnl - pulsePositionsStake(positions));
}

/**
 * Largest stake a player can send: available cash floored to the cent, so it
 * never lands a hair above what the server recomputes from the same row.
 */
export const pulseMaxStake = (availableCash: number) => Math.floor(availableCash * 100) / 100;

/** Rounds to the cent and clamps into [0, pulseMaxStake]. */
export const clampPulseStake = (stake: number, availableCash: number) =>
  Math.min(pulseMaxStake(availableCash), Math.max(0, Math.round(stake * 100) / 100));

/** Under a cent of cash and nothing open: liquidated out for the rest of the round. */
export const pulseIsOut = (positions: PulsePosition[], realizedPnl: number) =>
  positions.length === 0 && pulseMaxStake(pulseAvailableCash(positions, realizedPnl)) <= 0;

/** The price at which the position has lost its whole stake. */
export function pulseLiquidationPrice(position: PulsePosition) {
  return position.side === "long"
    ? position.entryPrice * (1 - 1 / position.leverage)
    : position.entryPrice * (1 + 1 / position.leverage);
}

/** Isolated margin: a position can lose its stake and no more. */
export function pulsePositionPnl(position: PulsePosition, price: number) {
  const move =
    position.side === "long"
      ? price - position.entryPrice
      : position.entryPrice - price;
  return Math.max(-position.stake, position.stake * (move / position.entryPrice) * position.leverage);
}

export const pulseIsLiquidated = (position: PulsePosition, price: number) =>
  pulsePositionPnl(position, price) <= -position.stake;

export function pulsePositionsPnl(positions: PulsePosition[], price: number) {
  return positions.reduce((total, position) => total + pulsePositionPnl(position, price), 0);
}

export function isPulseSide(value: unknown): value is PulseSide {
  return value === "long" || value === "short";
}

export function isPulseLeverage(value: number) {
  return (PULSE_LEVERAGE_OPTIONS as readonly number[]).includes(value);
}
