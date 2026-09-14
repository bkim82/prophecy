import {
  expireLocksIfDue,
  roleOf,
  settleFundsIfNeeded,
  settleIfDue,
  touchAndRead,
  viewFor,
} from "@/lib/match";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

/**
 * GET ?playerId= → the caller's role-scoped view of the match.
 *
 * This is the only endpoint the match room polls: it also stamps the caller's
 * heartbeat, closes the 15s lock window, and performs lazy settlement once the
 * round deadline has passed, so a round needs no cron and no second request
 * per tick. It is also what the lobby polls while queued in an `open` match.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });
  const { id } = await ctx.params;
  const playerId = new URL(request.url).searchParams.get("playerId") ?? "";
  if (!playerId) {
    return Response.json({ error: "Missing playerId" }, { status: 400 });
  }

  const touched = await touchAndRead(id, playerId);
  if (!touched) {
    return Response.json({ error: "Match not found" }, { status: 404 });
  }

  const role = roleOf(touched, playerId);
  if (!role) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }
  if ((role === 1 ? touched.player1UserId : touched.player2UserId) !== userId) {
    return Response.json({ error: "Not in this match" }, { status: 403 });
  }

  // Both deadlines are lazy: a poll is the only thing that moves the row on.
  // Expiry can hand back a `countdown` row, so settlement runs on its result.
  const row = await settleIfDue(await expireLocksIfDue(touched));
  await settleFundsIfNeeded(row);
  return Response.json(viewFor(row, role), {
    headers: { "Cache-Control": "no-store" },
  });
}
