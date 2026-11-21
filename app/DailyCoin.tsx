"use client";

// One coin so far — add more here and the day-of-year rotation spreads them
// out automatically, no rotation logic to touch. The Arena market switcher
// (app/duel/page.tsx) tags whichever coin this picks as "Daily".
const DAILY_COINS = ["HYPE"];

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / 86_400_000);
}

export function pickDailyCoin(date: Date = new Date()) {
  return DAILY_COINS[dayOfYear(date) % DAILY_COINS.length];
}
