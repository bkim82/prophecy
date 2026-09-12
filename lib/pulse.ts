export type PulseSide = "long" | "short";

export type PulsePosition = {
  id: string;
  side: PulseSide;
  entryPrice: number;
  stake: number;
  leverage: number;
};

export const PULSE_STARTING_CASH = 100;
export const PULSE_STAKE_MAX = PULSE_STARTING_CASH;
export const PULSE_LEVERAGE_OPTIONS = [100, 1000, 10000] as const;

/** Cash reserved by open positions. It is returned when a position closes. */
export function pulsePositionsStake(positions: PulsePosition[]) {
  return positions.reduce((total, position) => total + position.stake, 0);
}

/** Cash still available for new entries after realized P&L and open stakes. */
export function pulseAvailableCash(positions: PulsePosition[], realizedPnl: number) {
  return Math.max(0, PULSE_STARTING_CASH + realizedPnl - pulsePositionsStake(positions));
}

export function pulsePositionPnl(position: PulsePosition, price: number) {
  const move =
    position.side === "long"
      ? price - position.entryPrice
      : position.entryPrice - price;
  return position.stake * (move / position.entryPrice) * position.leverage;
}

export function pulsePositionsPnl(positions: PulsePosition[], price: number) {
  return positions.reduce((total, position) => total + pulsePositionPnl(position, price), 0);
}

export function isPulseSide(value: unknown): value is PulseSide {
  return value === "long" || value === "short";
}

export function isPulseLeverage(value: number) {
  return (PULSE_LEVERAGE_OPTIONS as readonly number[]).includes(value);
}
