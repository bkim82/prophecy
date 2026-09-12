import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";

export type MatchRow = typeof matches.$inferSelect;
export type MatchStatus = "open" | "predict" | "countdown" | "settled";

/**
 * How stale a heartbeat may get before a player counts as gone. Only gates
 * matchmaking/listing of `open` matches and the "opponent disconnected" notice
 * during `predict` — once both players lock, the match settles without either.
 */
export const PRESENCE_MS = 8000;

/** Cutoff for "seen recently", on the app-server clock (all writes use it too). */
export const presenceCutoff = () => new Date(Date.now() - PRESENCE_MS);

const isFresh = (seen: Date | null) =>
  seen !== null && Date.now() - seen.getTime() < PRESENCE_MS;

export const roleOf = (row: MatchRow, playerId: string): 1 | 2 | null =>
  row.player1Id === playerId ? 1 : row.player2Id === playerId ? 2 : null;

export const deadlineOf = (row: MatchRow): number | null =>
  row.roundStartAt === null
    ? null
    : row.roundStartAt.getTime() + row.timerSeconds * 1000;

/**
 * How long both players get to lock a prediction once the second one joins.
 * Fixed for every match, unlike `timerSeconds`, which the host picks.
 */
export const LOCK_SECONDS = 15;

export const lockDeadlineOf = (row: MatchRow): number | null =>
  row.predictStartAt === null
    ? null
    : row.predictStartAt.getTime() + LOCK_SECONDS * 1000;

export async function findMatch(id: string): Promise<MatchRow | null> {
  const [row] = await getDb().select().from(matches).where(eq(matches.id, id));
  return row ?? null;
}

/**
 * Reads the row and stamps the caller's heartbeat in one statement — the poll
 * endpoint is the only heartbeat there is, so presence costs no extra request.
 * `neon-http` sends one HTTP round trip per statement, hence the CASE rather
 * than a read followed by a role-specific write.
 */
export async function touchAndRead(
  id: string,
  playerId: string,
): Promise<MatchRow | null> {
  // Raw `sql` params bypass the column's mapper, so the instant is spelled out
  // and cast explicitly rather than left to the driver's Date coercion.
  const now = sql`${new Date().toISOString()}::timestamptz`;
  const [row] = await getDb()
    .update(matches)
    .set({
      player1LastSeen: sql`CASE WHEN ${matches.player1Id} = ${playerId} THEN ${now} ELSE ${matches.player1LastSeen} END`,
      player2LastSeen: sql`CASE WHEN ${matches.player2Id} = ${playerId} THEN ${now} ELSE ${matches.player2LastSeen} END`,
    })
    .where(eq(matches.id, id))
    .returning();
  return row ?? null;
}

/**
 * Closes the 15-second lock window once it has passed. Lazy and idempotent,
 * the same shape as `settleIfDue`: every poll may call it, exactly one guarded
 * UPDATE lands. Each guard also re-states what was read, so a lock request
 * arriving in the same instant either wins the seat (and this call falls
 * through to a re-read) or loses to the expiry.
 *
 * - both locked  -> start the countdown, dated to the deadline, not to now
 * - one locked   -> that player wins by forfeit; `finalPrice` stays null
 * - neither      -> settled as a tie with no predictions and no final price
 */
export async function expireLocksIfDue(row: MatchRow): Promise<MatchRow> {
  if (row.status !== "predict") return row;
  const deadline = lockDeadlineOf(row);
  if (deadline === null || Date.now() < deadline) return row;

  const locked1 = row.prediction1 !== null;
  const locked2 = row.prediction2 !== null;

  const db = getDb();
  const guard = and(eq(matches.id, row.id), eq(matches.status, "predict"));
  const [updated] = locked1 && locked2
    ? await db
        .update(matches)
        .set({ status: "countdown", roundStartAt: new Date(deadline) })
        .where(guard)
        .returning()
    : await db
        .update(matches)
        .set({
          status: "settled",
          winner: locked1 ? "1" : locked2 ? "2" : "tie",
        })
        .where(
          and(
            guard,
            // Re-assert the empty slots: whoever locked between the read and
            // this statement must not be forfeited.
            ...(locked1 ? [] : [isNull(matches.prediction1)]),
            ...(locked2 ? [] : [isNull(matches.prediction2)]),
          ),
        )
        .returning();

  // No row back = a lock landed first; re-read and let that path own the row.
  return updated ?? (await findMatch(row.id)) ?? row;
}

/**
 * Settles a match whose deadline has passed. Idempotent and race-safe: the
 * guarded UPDATE lands once no matter how many polls notice at the same time.
 * A price-source outage leaves the row in `countdown` so the next poll retries.
 */
export async function settleIfDue(row: MatchRow): Promise<MatchRow> {
  if (row.status !== "countdown") return row;
  const deadline = deadlineOf(row);
  if (deadline === null || Date.now() < deadline) return row;
  if (row.prediction1 === null || row.prediction2 === null) return row;

  const product = productForMarket(row.market);
  if (!product) return row;
  const spot = await getSpotPrice(product);
  if (!spot) return row;

  const diff1 = Math.abs(spot.price - row.prediction1);
  const diff2 = Math.abs(spot.price - row.prediction2);
  const winner = diff1 === diff2 ? "tie" : diff1 < diff2 ? "1" : "2";

  const [settled] = await getDb()
    .update(matches)
    .set({ status: "settled", finalPrice: spot.price, winner })
    .where(and(eq(matches.id, row.id), eq(matches.status, "countdown")))
    .returning();

  // No row back = another request settled it first; its values win.
  return settled ?? (await findMatch(row.id)) ?? row;
}

/** What one player is allowed to see. The opponent's number stays hidden until the round starts. */
export type MatchView = {
  id: string;
  market: string;
  mode: string;
  wager: number;
  timerSeconds: number;
  status: MatchStatus;
  you: 1 | 2;
  opponentJoined: boolean;
  opponentPresent: boolean;
  yourPrediction: number | null;
  yourLockedAt: number | null;
  opponentLocked: boolean;
  opponentLockedAt: number | null;
  /**
   * null until the round starts — this is the whole point of the role-scoped
   * view. Both numbers go public at `countdown`, once neither can be changed.
   */
  opponentPrediction: number | null;
  /** End of the 15s lock window; null outside `predict`. */
  lockDeadlineAt: number | null;
  roundStartAt: number | null;
  deadlineAt: number | null;
  finalPrice: number | null;
  winner: "you" | "opponent" | "tie" | null;
  /** Lets the client correct for clock skew before running the countdown. */
  serverNow: number;
};

export function viewFor(row: MatchRow, you: 1 | 2): MatchView {
  // Predictions are frozen from `countdown` on, so there is nothing left to
  // game by seeing the opponent's — reveal both as the round starts.
  const revealed = row.status === "countdown" || row.status === "settled";
  const mine = you === 1;
  const yourPrediction = mine ? row.prediction1 : row.prediction2;
  const oppPrediction = mine ? row.prediction2 : row.prediction1;
  const yourLockedAt = mine ? row.lockedAt1 : row.lockedAt2;
  const oppLockedAt = mine ? row.lockedAt2 : row.lockedAt1;
  const oppLastSeen = mine ? row.player2LastSeen : row.player1LastSeen;

  const winner =
    row.winner === null
      ? null
      : row.winner === "tie"
        ? ("tie" as const)
        : row.winner === String(you)
          ? ("you" as const)
          : ("opponent" as const);

  return {
    id: row.id,
    market: row.market,
    mode: row.mode,
    wager: row.wager,
    timerSeconds: row.timerSeconds,
    status: row.status as MatchStatus,
    you,
    opponentJoined: row.player2Id !== null,
    opponentPresent: isFresh(oppLastSeen),
    yourPrediction,
    yourLockedAt: yourLockedAt?.getTime() ?? null,
    opponentLocked: oppPrediction !== null,
    opponentLockedAt: oppLockedAt?.getTime() ?? null,
    opponentPrediction: revealed ? oppPrediction : null,
    lockDeadlineAt: row.status === "predict" ? lockDeadlineOf(row) : null,
    roundStartAt: row.roundStartAt?.getTime() ?? null,
    deadlineAt: deadlineOf(row),
    finalPrice: row.finalPrice,
    winner,
    serverNow: Date.now(),
  };
}

/** Reads `playerId` off a JSON body, rejecting the shapes routes can't act on. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
