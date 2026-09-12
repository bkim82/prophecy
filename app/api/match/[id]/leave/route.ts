import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
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

  const [deleted] = await getDb()
    .delete(matches)
    .where(and(eq(matches.id, id), inArray(matches.status, ["open", "predict"])))
    .returning();
  if (deleted) {
    return Response.json({ left: true });
  }
  return Response.json({ error: "Round already started" }, { status: 409 });
}
