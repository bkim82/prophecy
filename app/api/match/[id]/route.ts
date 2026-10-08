import {
  expireLocksIfDue,
  liquidateIfDue,
  roleOf,
  settleFundsIfNeeded,
  settleIfDue,
  touchAndRead,
  viewFor,
} from "@/lib/match";
import { auth } from "@clerk/nextjs/server";
import { driveBot, seatBotIfWaiting } from "@/lib/bots";
import { opponentNames } from "@/lib/opponentNames";

export const dynamic = "force-dynamic";

/**
 * GET ?playerId= → the caller's role-scoped view of the match.
 *
 * This is the only endpoint the match room polls: it also stamps the caller's
 * heartbeat, closes the 5s pre-round countdown, and performs lazy settlement once the
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
  // A house bot takes a lonely queue's seat and makes its trades here too.
  // Liquidation runs first so the bot and settlement never see a dead position.
  const live = await liquidateIfDue(await expireLocksIfDue(await seatBotIfWaiting(touched)));
  const row = await settleIfDue(await driveBot(live));
  await settleFundsIfNeeded(row);
  const view = viewFor(row, role);
  // Who you played stays hidden until the round is over.
  if (row.status === "settled") {
    const opponentUserId = role === 1 ? row.player2UserId : row.player1UserId;
    const names = await opponentNames([opponentUserId]);
    view.opponentName = (opponentUserId && names.get(opponentUserId)) || null;
  }
  return Response.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}
