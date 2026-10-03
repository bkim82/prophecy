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

// Rendered inside a .market-switcher so it selects exactly like BTC/ETH; the
// "Daily" prefix is the only thing marking it as the rotating slot.
export function DailyCoin({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const coin = pickDailyCoin();

  return (
    <button
      type="button"
      className={`daily-coin${active ? " active" : ""}`}
      aria-pressed={active}
      title="Daily coin — rotates by day of the year"
      onClick={onSelect}
    >
      <span className="daily-coin-label">Daily</span>
      <span className="daily-coin-sep" aria-hidden="true">·</span>
      {coin}
    </button>
  );
}
