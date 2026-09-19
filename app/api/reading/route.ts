import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/db";
import { readings } from "@/db/schema";
import { refundBalance, reserveBalance } from "@/lib/balance";
import {
  READING_MAX_WAGER,
  currentReadingFor,
  isReadingLeverage,
  isReadingSide,
  normalizeTzOffset,
  readingCalendarFor,
  readingDayStartFor,
  readingId,
  latestSettledReadingFor,
  readingMonthRangeFor,
  readingStatsFor,
  readingView,
  readingWindowFor,
  settleReadingsIfDue,
} from "@/lib/reading";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

/**
 * GET ?market=&tzOffsetMinutes= → the caller's current 24h Reading window,
 * their call for it (if any), and their stats for this market. Settles any
 * past-due calls first, the same lazy pattern as /api/match/[id].
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const url = new URL(request.url);
  const market = url.searchParams.get("market") ?? "";
  if (!productForMarket(market)) {
    return Response.json({ error: "Unsupported market" }, { status: 400 });
  }
  const tzOffsetMinutes = normalizeTzOffset(url.searchParams.get("tzOffsetMinutes"));
  if (tzOffsetMinutes === null) {
    return Response.json({ error: "Missing tzOffsetMinutes" }, { status: 400 });
  }

  await settleReadingsIfDue(userId);

  const now = Date.now();
  const { windowStartAt, windowEndAt } = readingWindowFor(now, tzOffsetMinutes);
  const dayStartAt = readingDayStartFor(now, tzOffsetMinutes);
  const { monthStartAt, monthEndAt } = readingMonthRangeFor(now, tzOffsetMinutes);

  const [current, lastSettled, stats, calendar] = await Promise.all([
    currentReadingFor(userId, market, windowStartAt.getTime()),
    latestSettledReadingFor(userId, market),
    readingStatsFor(userId, market, dayStartAt),
    readingCalendarFor(userId, market, monthStartAt, monthEndAt, tzOffsetMinutes),
  ]);

  return Response.json(
    {
      serverNow: now,
      windowStartAt: windowStartAt.getTime(),
      windowEndAt: windowEndAt.getTime(),
      current: current ? readingView(current) : null,
      lastSettled: lastSettled ? readingView(lastSettled) : null,
      stats,
      calendar,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * POST { market, side, wager, leverage, tzOffsetMinutes } → { reading }
 *
 * Places this window's call. `id` is deterministic per user/market/window, so
 * the insert itself is the guard against a second call in the same window —
 * a collision refunds the reservation and returns 409 rather than reading
 * first and racing a second request.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const market = typeof body.market === "string" ? body.market : "";
  const side = body.side;
  const wager = Number(body.wager);
  const leverage = Number(body.leverage);
  const tzOffsetMinutes = normalizeTzOffset(body.tzOffsetMinutes);

  const product = productForMarket(market);
  if (!product) return Response.json({ error: "Unsupported market" }, { status: 400 });
  if (!isReadingSide(side)) return Response.json({ error: "Invalid side" }, { status: 400 });
  if (!Number.isInteger(wager) || wager <= 0 || wager > READING_MAX_WAGER) {
    return Response.json({ error: "Invalid wager" }, { status: 400 });
  }
  if (!isReadingLeverage(leverage)) return Response.json({ error: "Invalid leverage" }, { status: 400 });
  if (tzOffsetMinutes === null) return Response.json({ error: "Missing tzOffsetMinutes" }, { status: 400 });

  const spot = await getSpotPrice(product);
  if (!spot) return Response.json({ error: "Price unavailable" }, { status: 503 });

  const { windowStartAt, windowEndAt } = readingWindowFor(Date.now(), tzOffsetMinutes);
  const id = readingId(userId, market, windowStartAt.getTime());

  const reserved = await reserveBalance(userId, wager);
  if (!reserved) return Response.json({ error: "Insufficient balance" }, { status: 402 });

  try {
    const [created] = await getDb()
      .insert(readings)
      .values({
        id,
        userId,
        market,
        side,
        wager,
        leverage,
        entryPrice: spot.price,
        windowStartAt,
        windowEndAt,
        status: "open",
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      await refundBalance(userId, wager);
      return Response.json({ error: "Already called this window" }, { status: 409 });
    }

    return Response.json({ reading: readingView(created) });
  } catch (error) {
    await refundBalance(userId, wager);
    throw error;
  }
}
