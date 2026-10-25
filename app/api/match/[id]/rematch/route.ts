import { readBody, roleOf, touchAndRead, type MatchRow } from "@/lib/match";
import { offersRematch, pressPlayAgain, rematchView } from "@/lib/rematch";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A settled challenge round's rematch (lib/rematch.ts). Both methods stamp
 * the caller's match heartbeat as they read (touchAndRead) — that heartbeat is
 * what keeps their ask alive, and how the other player knows they're still in
 * the room.
 *
 * GET ?playerId= → RematchView. Polled by the settled room.
 * POST { playerId } → RematchView ("Play again"); `nextMatchId` once both pressed it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const seat = await seatFor(id, new URL(request.url).searchParams.get("playerId") ?? "");
  if ("error" in seat) return seat.error;
  if (!offersRematch(seat.row)) return Response.json({ error: "No rematch for this round" }, { status: 409 });
  return Response.json(await rematchView(seat.row, seat.role), { headers: NO_STORE });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const seat = await seatFor(id, typeof body.playerId === "string" ? body.playerId : "");
  if ("error" in seat) return seat.error;
  const result = await pressPlayAgain(seat.row, seat.role);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.view, { headers: NO_STORE });
}

// The same seat check as GET /api/match/[id]: this browser's seat, held by the signed-in account.
async function seatFor(id: string, playerId: string): Promise<{ row: MatchRow; role: 1 | 2 } | { error: Response }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { error: Response.json({ error: "Sign in to play" }, { status: 401 }) };
  if (!playerId) return { error: Response.json({ error: "Missing playerId" }, { status: 400 }) };
  const row = await touchAndRead(id, playerId);
  if (!row) return { error: Response.json({ error: "Match not found" }, { status: 404 }) };
  const role = roleOf(row, playerId);
  if (!role || (role === 1 ? row.player1UserId : row.player2UserId) !== userId) {
    return { error: Response.json({ error: "Not in this match" }, { status: 403 }) };
  }
  return { row, role };
}
