import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { expireLocksIfDue, findMatch, readBody, roleOf, settleFundsIfNeeded, viewFor } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * POST { playerId, prediction } → the caller's match view.
 *
 * Two guarded UPDATEs, no transaction (neon-http has none): the first writes
 * this player's prediction only if the slot is still empty; the second starts
 * the countdown only if the round hasn't started. Only the request that
 * completed the *second* lock sees both predictions non-null, so `roundStartAt`
 * is stamped exactly once however the two requests interleave.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await readBody(request);
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const prediction = Number(body.prediction);
  if (!playerId) {
    return Response.json({ error: "Missing playerId" }, { status: 400 });
  }
  if (!Number.isFinite(prediction) || prediction <= 0) {
    return Response.json({ error: "Invalid prediction" }, { status: 400 });
  }

  const found = await findMatch(id);
  if (!found) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }
  const role = roleOf(found, playerId);
  if (!role) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }
  if ((role === 1 ? found.player1UserId : found.player2UserId) !== userId) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }
  if (found.mode !== "quick-play") {
    return Response.json({ error: "Pulse matches use position actions" }, { status: 409 });
  }
  // A lock that arrives after the 15s window closes must not land: close the
  // window here rather than trusting the opponent's poll to have done it.
  const row = await expireLocksIfDue(found);
  if (row.status !== "predict") {
    return Response.json({ error: "Match is not taking predictions" }, { status: 409 });
  }

  const db = getDb();
  const now = new Date();
  const [locked] = await db
    .update(matches)
    .set(
      role === 1
        ? { prediction1: prediction, lockedAt1: now }
        : { prediction2: prediction, lockedAt2: now },
    )
    .where(
      and(
        eq(matches.id, id),
        eq(matches.status, "predict"),
        role === 1 ? isNull(matches.prediction1) : isNull(matches.prediction2),
      ),
    )
    .returning();

  // Nothing written = already locked (or the round moved on). Report the truth.
  if (!locked) {
    const current = await findMatch(id);
    if (!current) {
      return Response.json({ error: "Match not found" }, { status: 404 });
    }
    return Response.json(viewFor(current, role));
  }

  if (locked.prediction1 !== null && locked.prediction2 !== null) {
    const [started] = await db
      .update(matches)
      .set({ status: "countdown", roundStartAt: now })
      .where(and(eq(matches.id, id), eq(matches.status, "predict")))
      .returning();
    if (started) {
      return Response.json(viewFor(started, role));
    }
  }

  await settleFundsIfNeeded(locked);

  return Response.json(viewFor(locked, role));
}
