import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";
import { refundBalance } from "@/lib/balance";
import { findMatch, readBody, roleOf } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * POST { playerId } → { left: boolean }
 *
 * Deletes the row while it is still `open` or `predict`; the other player's
 * next poll 404s and returns them to the lobby. Once the countdown is running
 * the match belongs to its two stored predictions, not to anyone's tab, so
 * leaving is refused (409) — the round settles either way.
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

  const row = await findMatch(id);
  if (!row) {
    return Response.json({ left: true });
  }
  if (!roleOf(row, playerId)) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }
  const role = roleOf(row, playerId);
  if ((role === 1 ? row.player1UserId : row.player2UserId) !== userId) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }

  const [deleted] = await getDb()
    .delete(matches)
    .where(and(eq(matches.id, id), inArray(matches.status, ["open", "predict"])))
    .returning();
  if (deleted) {
    const refunds = [
      deleted.player1UserId,
      deleted.player2UserId,
    ];
    await Promise.all(
      refunds.filter((userId): userId is string => Boolean(userId)).map((userId) =>
        refundBalance(userId, deleted.wager),
      ),
    );
    return Response.json({ left: true });
  }
  return Response.json({ error: "Round already started" }, { status: 409 });
}
