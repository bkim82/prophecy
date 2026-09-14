import { and, eq, gt, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { findMatch, presenceCutoff, readBody, roleOf } from "@/lib/match";
import { refundBalance, reserveBalance } from "@/lib/balance";

export const dynamic = "force-dynamic";

/**
 * POST { playerId } → { matchId }
 *
 * The "browse the lobby list and take that one" path. Same guarded UPDATE as
 * find-or-create, aimed at a specific id: whoever's statement lands first gets
 * the seat, everyone else gets 409.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await readBody(request);
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  if (!playerId) {
    return Response.json({ error: "Missing playerId" }, { status: 400 });
  }

  const candidate = await findMatch(id);
  if (!candidate) return Response.json({ error: "Match not found" }, { status: 404 });
  const existingRole = roleOf(candidate, playerId);
  if (existingRole && (existingRole === 1 ? candidate.player1UserId : candidate.player2UserId) === userId) {
    return Response.json({ matchId: candidate.id });
  }
  const reserved = await reserveBalance(userId, candidate.wager);
  if (!reserved) return Response.json({ error: "Insufficient balance" }, { status: 402 });

  const now = new Date();
  const [joined] = await getDb()
    .update(matches)
    .set({
      player2Id: playerId,
      player2LastSeen: now,
      status: "predict",
      player2UserId: userId,
      // Starts the 15s lock window for both players at the same instant.
      predictStartAt: now,
    })
    .where(
      and(
        eq(matches.id, id),
        eq(matches.status, "open"),
        isNull(matches.player2Id),
        // A direct invite should only claim a queue the host is still holding.
        gt(matches.player1LastSeen, presenceCutoff()),
      ),
    )
    .returning();
  if (joined) {
    return Response.json({ matchId: joined.id });
  }

  await refundBalance(userId, candidate.wager);

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
