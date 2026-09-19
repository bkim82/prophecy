// Pure 24h Reading math and window rules — no DB import, so client pages can
// safely pull in the live P&L preview and constants (mirrors lib/pulse.ts
// sitting next to the DB-touching lib/match.ts).

export type ReadingSide = "long" | "short";

export const READING_WINDOW_MS = 6 * 60 * 60 * 1000;
export const READING_LEVERAGE_OPTIONS = [1, 5, 10, 20] as const;
export const READING_MAX_WAGER = 1_000_000;
export const READING_MAX_TZ_OFFSET_MIN = 14 * 60; // UTC-14..UTC+12, generous either side

export const isReadingSide = (value: unknown): value is ReadingSide =>
  value === "long" || value === "short";

export const isReadingLeverage = (value: number) =>
  (READING_LEVERAGE_OPTIONS as readonly number[]).includes(value);

export function normalizeTzOffset(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > READING_MAX_TZ_OFFSET_MIN) return null;
  return Math.round(n);
}

// `Date.prototype.getTimezoneOffset()` is UTC-minus-local, in minutes, so
// `local = utc - offset` and `utc = local + offset`. Reading the shifted
// instant's *UTC* fields back out gives correct local wall-clock numbers
// regardless of which timezone a reader (server or browser) itself runs in.
const localWallClock = (atMs: number, tzOffsetMinutes: number) =>
  new Date(atMs - tzOffsetMinutes * 60_000);

const toUtcInstant = (localWallMs: number, tzOffsetMinutes: number) =>
  new Date(localWallMs + tzOffsetMinutes * 60_000);

/**
 * The 6-hour window a call placed at `atMs` belongs to, anchored to
 * 00:00/06:00/12:00/18:00 in the caller's own local time. Boundaries are
 * absolute instants computed once, not recomputed from a live clock later.
 */
export function readingWindowFor(atMs: number, tzOffsetMinutes: number) {
  const local = localWallClock(atMs, tzOffsetMinutes);
  const boundaryHour = Math.floor(local.getUTCHours() / 6) * 6;
  const startLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    boundaryHour,
  );
  const windowStartAt = toUtcInstant(startLocalMs, tzOffsetMinutes);
  const windowEndAt = new Date(windowStartAt.getTime() + READING_WINDOW_MS);
  return { windowStartAt, windowEndAt };
}

/** Start of the caller's local calendar day, for scoping "day P&L". */
export function readingDayStartFor(atMs: number, tzOffsetMinutes: number) {
  const local = localWallClock(atMs, tzOffsetMinutes);
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return toUtcInstant(startLocalMs, tzOffsetMinutes);
}

/** [monthStartAt, monthEndAt) of the caller's local calendar month, for the calendar tile's per-day P&L. */
export function readingMonthRangeFor(atMs: number, tzOffsetMinutes: number) {
  const local = localWallClock(atMs, tzOffsetMinutes);
  const startLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  const endLocalMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
  return { monthStartAt: toUtcInstant(startLocalMs, tzOffsetMinutes), monthEndAt: toUtcInstant(endLocalMs, tzOffsetMinutes) };
}

/** The caller's local day-of-month (1-31) for an absolute instant, for bucketing calendar rows. */
export function readingLocalDayOfMonth(atMs: number, tzOffsetMinutes: number) {
  return localWallClock(atMs, tzOffsetMinutes).getUTCDate();
}

export const readingId = (userId: string, market: string, windowStartMs: number) =>
  `${userId}:${market}:${windowStartMs}`;

/** Same stop-out shape as Pulse (lib/pulse.ts pulsePositionPnl): a loss can never exceed the wager. */
export function readingPnl(
  row: { wager: number; leverage: number; side: ReadingSide; entryPrice: number },
  exitPrice: number,
) {
  const move =
    row.side === "long"
      ? (exitPrice - row.entryPrice) / row.entryPrice
      : (row.entryPrice - exitPrice) / row.entryPrice;
  const raw = row.wager * move * row.leverage;
  return Math.round(Math.max(raw, -row.wager));
}
