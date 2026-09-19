import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { readingPayouts, readings, users } from "@/db/schema";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";
import { readingId, readingLocalDayOfMonth, readingPnl, type ReadingSide } from "@/lib/readingRules";

export * from "@/lib/readingRules";

export type ReadingRow = typeof readings.$inferSelect;

/** Idempotent payout ledger, same pattern as lib/balance.ts creditPayout. */
async function creditReadingPayout(id: string, userId: string, amount: number) {
  await getDb().execute(sql`
    WITH credited AS (
      INSERT INTO ${readingPayouts} (id, reading_id, user_id, amount)
      VALUES (${id}, ${id}, ${userId}, ${amount})
      ON CONFLICT (id) DO NOTHING
      RETURNING user_id, amount
    )
    UPDATE ${users}
    SET balance = ${users.balance} + credited.amount
    FROM credited
    WHERE ${users.id} = credited.user_id
  `);
}

/**
 * Settles every call of this user's whose window has closed. Lazy and
 * idempotent, the same shape as lib/match.ts settleIfDue: any poll may call
 * it, at most one guarded UPDATE lands per row. A price-source outage leaves
 * the row `open` for the next poll to retry.
 */
export async function settleReadingsIfDue(userId: string): Promise<void> {
  const db = getDb();
  const due = await db
    .select()
    .from(readings)
    .where(
      and(eq(readings.userId, userId), eq(readings.status, "open"), lte(readings.windowEndAt, new Date())),
    );

  for (const row of due) {
    const product = productForMarket(row.market);
    if (!product) continue;
    const spot = await getSpotPrice(product);
    if (!spot) continue;

    const pnl = readingPnl(
      { wager: row.wager, leverage: row.leverage, side: row.side as ReadingSide, entryPrice: row.entryPrice },
      spot.price,
    );
    const [settled] = await db
      .update(readings)
      .set({ status: "settled", exitPrice: spot.price, pnl, settledAt: new Date() })
      .where(and(eq(readings.id, row.id), eq(readings.status, "open")))
      .returning();
    if (settled) {
      await creditReadingPayout(settled.id, userId, settled.wager + pnl);
    }
  }
}

export async function currentReadingFor(
  userId: string,
  market: string,
  windowStartMs: number,
): Promise<ReadingRow | null> {
  const id = readingId(userId, market, windowStartMs);
  const [row] = await getDb().select().from(readings).where(eq(readings.id, id));
  return row ?? null;
}

export async function latestSettledReadingFor(userId: string, market: string): Promise<ReadingRow | null> {
  const [row] = await getDb()
    .select()
    .from(readings)
    .where(and(eq(readings.userId, userId), eq(readings.market, market), eq(readings.status, "settled")))
    .orderBy(desc(readings.windowEndAt))
    .limit(1);
  return row ?? null;
}

export type ReadingStats = {
  cumulativePnl: number;
  dayPnl: number;
  wins: number;
  losses: number;
  accuracy: number; // 0-100, one decimal
};

/** Cumulative and day P&L, wins/losses and accuracy — one combined row in the UI. */
export async function readingStatsFor(
  userId: string,
  market: string,
  dayStartAt: Date,
): Promise<ReadingStats> {
  const db = getDb();
  const settledFilter = and(
    eq(readings.userId, userId),
    eq(readings.market, market),
    eq(readings.status, "settled"),
  );

  const [totals] = await db
    .select({
      cumulativePnl: sql<number>`coalesce(sum(${readings.pnl}), 0)`,
      wins: sql<number>`coalesce(sum(case when ${readings.pnl} > 0 then 1 else 0 end), 0)`,
      losses: sql<number>`coalesce(sum(case when ${readings.pnl} <= 0 then 1 else 0 end), 0)`,
    })
    .from(readings)
    .where(settledFilter);

  const [dayTotals] = await db
    .select({ dayPnl: sql<number>`coalesce(sum(${readings.pnl}), 0)` })
    .from(readings)
    .where(and(settledFilter, gte(readings.windowStartAt, dayStartAt)));

  const wins = Number(totals?.wins ?? 0);
  const losses = Number(totals?.losses ?? 0);
  const accuracy = wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 1000) / 10;

  return {
    cumulativePnl: Number(totals?.cumulativePnl ?? 0),
    dayPnl: Number(dayTotals?.dayPnl ?? 0),
    wins,
    losses,
    accuracy,
  };
}

export type ReadingView = {
  id: string;
  market: string;
  side: ReadingSide;
  wager: number;
  leverage: number;
  entryPrice: number;
  windowStartAt: number;
  windowEndAt: number;
  status: "open" | "settled";
  exitPrice: number | null;
  pnl: number | null;
  placedAt: number;
};

export function readingView(row: ReadingRow): ReadingView {
  return {
    id: row.id,
    market: row.market,
    side: row.side as ReadingSide,
    wager: row.wager,
    leverage: row.leverage,
    entryPrice: row.entryPrice,
    windowStartAt: row.windowStartAt.getTime(),
    windowEndAt: row.windowEndAt.getTime(),
    status: row.status as "open" | "settled",
    exitPrice: row.exitPrice,
    pnl: row.pnl,
    placedAt: row.createdAt.getTime(),
  };
}

export type ReadingCalendarDay = { day: number; pnl: number; wins: number; losses: number };

/**
 * Per-local-day P&L for the calendar tile, bucketed by the local day the call
 * was placed (`windowStartAt`, same anchor `readingStatsFor` uses for "day
 * P&L"). `[monthStartAt, monthEndAt)` should come from `readingMonthRangeFor`
 * so the bucketing timezone matches the range's.
 */
export async function readingCalendarFor(
  userId: string,
  market: string,
  monthStartAt: Date,
  monthEndAt: Date,
  tzOffsetMinutes: number,
): Promise<ReadingCalendarDay[]> {
  const rows = await getDb()
    .select({ windowStartAt: readings.windowStartAt, pnl: readings.pnl })
    .from(readings)
    .where(
      and(
        eq(readings.userId, userId),
        eq(readings.market, market),
        eq(readings.status, "settled"),
        gte(readings.windowStartAt, monthStartAt),
        lt(readings.windowStartAt, monthEndAt),
      ),
    );

  const byDay = new Map<number, ReadingCalendarDay>();
  for (const row of rows) {
    const day = readingLocalDayOfMonth(row.windowStartAt.getTime(), tzOffsetMinutes);
    const pnl = row.pnl ?? 0;
    const entry = byDay.get(day) ?? { day, pnl: 0, wins: 0, losses: 0 };
    entry.pnl += pnl;
    if (pnl > 0) entry.wins += 1;
    else entry.losses += 1;
    byDay.set(day, entry);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
}
