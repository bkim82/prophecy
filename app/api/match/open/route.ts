import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { presenceCutoff } from "@/lib/match";

export const dynamic = "force-dynamic";

const LIMIT = 12;

/**
 * GET ?market=&mode=&playerId= → { matches: [...] } for the lobby's list.
 *
 * Stale rows are filtered by heartbeat rather than deleted: an abandoned match
 * just stops being visible and matchable, which is why there is no cleanup job.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market");
  const mode = searchParams.get("mode");
  const playerId = searchParams.get("playerId");

  const rows = await getDb()
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.status, "open"),
        gt(matches.player1LastSeen, presenceCutoff()),
        ...(market ? [eq(matches.market, market)] : []),
        ...(mode ? [eq(matches.mode, mode)] : []),
      ),
    )
    .orderBy(desc(matches.createdAt))
    .limit(LIMIT);

  return Response.json(
    {
      matches: rows.map((row) => ({
        id: row.id,
        market: row.market,
        mode: row.mode,
        wager: row.wager,
        timerSeconds: row.timerSeconds,
        createdAt: row.createdAt.getTime(),
        isYours: playerId !== null && row.player1Id === playerId,
      })),
      serverNow: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
