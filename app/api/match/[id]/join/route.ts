import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { findMatch, readBody, roleOf } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * POST { playerId } → { matchId }
 *
 * The "browse the lobby list and take that one" path. Same guarded UPDATE as
 * find-or-create, aimed at a specific id: whoever's statement lands first gets
 * the seat, everyone else gets 409.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    return Response.json({ error: "Missing playerId" }, { status: 400 });
  }

  const now = new Date();
  const [joined] = await getDb()
    .update(matches)
    .set({
      player2Id: playerId,
      player2LastSeen: now,
      status: "predict",
      // Starts the 15s lock window for both players at the same instant.
      predictStartAt: now,
    })
    .where(
      and(
        eq(matches.id, id),
        eq(matches.status, "open"),
        isNull(matches.player2Id),
      ),
    )
    .returning();
  if (joined) {
    return Response.json({ matchId: joined.id });
  }

  const row = await findMatch(id);
  if (!row) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  // Already a player here (retry, double-click, or your own open match) — let
  // the caller navigate in rather than bouncing them for a no-op.
  if (roleOf(row, playerId)) {
    return Response.json({ matchId: row.id });
  }
  return Response.json({ error: "Match is already full" }, { status: 409 });
}
