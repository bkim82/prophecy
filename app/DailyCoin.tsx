"use client";

// One coin so far — add more here and the day-of-year rotation spreads them
// out automatically, no rotation logic to touch.
const DAILY_COINS = ["DOGE"];

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / 86_400_000);
}

export function pickDailyCoin(date: Date = new Date()) {
  return DAILY_COINS[dayOfYear(date) % DAILY_COINS.length];
}

export function DailyCoin({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const coin = pickDailyCoin();

  return (
    <button type="button" className={`daily-coin${active ? " active" : ""}`} onClick={onSelect}>
      <span className="balance-label">Daily coin</span>
      <span className="tabular-nums">{coin}</span>
      <span className="daily-coin-tooltip" role="tooltip">
        Rotates daily by day of the year — check back tomorrow for a new coin.
      </span>
    </button>
  );
}
