import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { productForMarket } from "@/lib/spotPrice";
import { presenceCutoff, readBody } from "@/lib/match";

export const dynamic = "force-dynamic";

// Criteria have to agree exactly for two players to share a round, so the
// lobby's custom-wager box is bounded rather than free-form.
const MAX_WAGER = 1_000_000;
const MIN_TIMER = 10;
const MAX_TIMER = 3600;

/**
 * POST { playerId, market, mode, wager, timerSeconds } → { matchId, status }
 *
 * Joins the oldest live `open` match with identical criteria, or opens one.
 * `status` is what the caller lands in: `predict` means a seat was taken and
 * the room is live, `open` means the lobby should queue rather than navigate.
 * The join is a guarded UPDATE, so two players pressing Play at the same
 * instant can't both claim the same seat — the loser falls through to the
 * next candidate and finally to creating its own row.
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const market = typeof body.market === "string" ? body.market : "";
  const mode = typeof body.mode === "string" ? body.mode : "";
  const wager = Number(body.wager);
  const timerSeconds = Number(body.timerSeconds);

  if (!playerId) {
    return Response.json({ error: "Missing playerId" }, { status: 400 });
  }
  if (!productForMarket(market)) {
    return Response.json({ error: "Unsupported market" }, { status: 400 });
  }
  if (mode !== "quick-play") {
    return Response.json({ error: "Unsupported mode" }, { status: 400 });
  }
  if (!Number.isInteger(wager) || wager <= 0 || wager > MAX_WAGER) {
    return Response.json({ error: "Invalid wager" }, { status: 400 });
  }
  if (
    !Number.isInteger(timerSeconds) ||
    timerSeconds < MIN_TIMER ||
    timerSeconds > MAX_TIMER
  ) {
    return Response.json({ error: "Invalid timer" }, { status: 400 });
  }

  const db = getDb();
  const criteria = and(
    eq(matches.status, "open"),
    eq(matches.market, market),
    eq(matches.mode, mode),
    eq(matches.wager, wager),
    eq(matches.timerSeconds, timerSeconds),
    gt(matches.player1LastSeen, presenceCutoff()),
  );

  const candidates = await db
    .select()
    .from(matches)
    .where(criteria)
    .orderBy(asc(matches.createdAt))
    .limit(5);

  // A double-tapped Play button should land back in the room you already
  // opened rather than stacking a second empty match behind it.
  const own = candidates.find((row) => row.player1Id === playerId);
  if (own) {
    return Response.json({ matchId: own.id, status: own.status, created: false });
  }

  for (const candidate of candidates) {
    const now = new Date();
    const [joined] = await db
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
          eq(matches.id, candidate.id),
          eq(matches.status, "open"),
          isNull(matches.player2Id),
        ),
      )
      .returning();
    if (joined) {
      return Response.json({ matchId: joined.id, status: "predict", created: false });
    }
  }

  const now = new Date();
  const [created] = await db
    .insert(matches)
    .values({
      id: crypto.randomUUID(),
      market,
      mode,
      wager,
      timerSeconds,
      status: "open",
      player1Id: playerId,
      player1LastSeen: now,
      createdAt: now,
    })
    .returning();

  return Response.json({ matchId: created.id, status: "open", created: true });
}
