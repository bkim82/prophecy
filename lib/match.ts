import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import { pulsePositionsPnl, type PulsePosition } from "@/lib/pulse";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";
import { creditPayout } from "@/lib/balance";

export type MatchRow = typeof matches.$inferSelect;
export type MatchStatus = "open" | "predict" | "countdown" | "settled";

/**
 * How stale a heartbeat may get before a player counts as gone. Only gates
 * matchmaking/listing of `open` matches and the "opponent disconnected" notice
 * during `predict` — once the round starts, the match settles without either.
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

/** Pulse's automatic pre-round countdown, stamped when the second player joins. */
export const PULSE_START_SECONDS = 5;

export const lockDeadlineOf = (row: MatchRow): number | null =>
  row.predictStartAt === null
    ? null
    : row.predictStartAt.getTime() + PULSE_START_SECONDS * 1000;

export const pulsePositionsFor = (row: MatchRow, role: 1 | 2): PulsePosition[] =>
  (role === 1 ? row.pulsePositions1 : row.pulsePositions2) ?? [];

const pulseRealizedFor = (row: MatchRow, role: 1 | 2) =>
  (role === 1 ? row.pulseRealizedPnl1 : row.pulseRealizedPnl2) ?? 0;

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
 * Starts the round once the 5-second pre-round countdown has passed, dated to
 * the deadline, even with no positions. Lazy and idempotent, the same shape as
 * `settleIfDue`: every poll may call it, exactly one guarded UPDATE lands.
 */
export async function expireLocksIfDue(row: MatchRow): Promise<MatchRow> {
  if (row.status !== "predict") return row;
  const deadline = lockDeadlineOf(row);
  if (deadline === null || Date.now() < deadline) return row;

  const [started] = await getDb()
    .update(matches)
    .set({ status: "countdown", roundStartAt: new Date(deadline) })
    .where(and(eq(matches.id, row.id), eq(matches.status, "predict")))
    .returning();
  return started ?? (await findMatch(row.id)) ?? row;
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

  const product = productForMarket(row.market);
  if (!product) return row;
  const spot = await getSpotPrice(product);
  if (!spot) return row;

  const positions1 = pulsePositionsFor(row, 1);
  const positions2 = pulsePositionsFor(row, 2);
  // Treat the round deadline as a market close for every remaining
  // position. Clearing the arrays releases their reserved stakes, while
  // carrying the final P&L into realized keeps the balance settled.
  const profit1 = pulseRealizedFor(row, 1) + pulsePositionsPnl(positions1, spot.price);
  const profit2 = pulseRealizedFor(row, 2) + pulsePositionsPnl(positions2, spot.price);
  const winner = profit1 === profit2 ? "tie" : profit1 > profit2 ? "1" : "2";
  const [settled] = await getDb()
    .update(matches)
    .set({
      status: "settled",
      finalPrice: spot.price,
      winner,
      pulsePositions1: [],
      pulsePositions2: [],
      pulseRealizedPnl1: profit1,
      pulseRealizedPnl2: profit2,
      pulseProfit1: profit1,
      pulseProfit2: profit2,
    })
    .where(and(eq(matches.id, row.id), eq(matches.status, "countdown")))
    .returning();
  // No row back = another request settled it first; its values win.
  return settled ?? (await findMatch(row.id)) ?? row;
}

/** Pays a settled match. The payout ledger makes repeated polls harmless. */
export async function settleFundsIfNeeded(row: MatchRow): Promise<void> {
  if (row.status !== "settled") return;
  if (!row.player1UserId || !row.player2UserId || !row.winner) return;

  if (row.winner === "tie") {
    await Promise.all([
      creditPayout(row.id, 1, row.player1UserId, row.wager),
      creditPayout(row.id, 2, row.player2UserId, row.wager),
    ]);
    return;
  }

  const winnerRole = row.winner === "1" ? 1 : 2;
  const winnerId = winnerRole === 1 ? row.player1UserId : row.player2UserId;
  await creditPayout(row.id, winnerRole, winnerId, row.wager * 2);
}

/** What one player is allowed to see. The opponent's positions stay hidden until the round starts. */
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
  /** End of the 5s pre-round countdown; null outside `predict`. */
  lockDeadlineAt: number | null;
  roundStartAt: number | null;
  deadlineAt: number | null;
  finalPrice: number | null;
  winner: "you" | "opponent" | "tie" | null;
  pulseYourPositions: PulsePosition[];
  pulseOpponentPositions: PulsePosition[] | null;
  pulseYourRealizedPnl: number;
  pulseOpponentRealizedPnl: number;
  pulseYourProfit: number | null;
  pulseOpponentProfit: number | null;
  /** Lets the client correct for clock skew before running the countdown. */
  serverNow: number;
};

export function viewFor(row: MatchRow, you: 1 | 2): MatchView {
  // The opponent's positions go public as the round starts.
  const revealed = row.status === "countdown" || row.status === "settled";
  const oppLastSeen = you === 1 ? row.player2LastSeen : row.player1LastSeen;
  const pulseYourPositions = pulsePositionsFor(row, you);
  const pulseOpponentPositions = revealed
    ? pulsePositionsFor(row, you === 1 ? 2 : 1)
    : null;

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
    lockDeadlineAt: row.status === "predict" ? lockDeadlineOf(row) : null,
    roundStartAt: row.roundStartAt?.getTime() ?? null,
    deadlineAt: deadlineOf(row),
    finalPrice: row.finalPrice,
    winner,
    pulseYourPositions,
    pulseOpponentPositions,
    pulseYourRealizedPnl: pulseRealizedFor(row, you),
    pulseOpponentRealizedPnl: pulseRealizedFor(row, you === 1 ? 2 : 1),
    pulseYourProfit: you === 1 ? row.pulseProfit1 : row.pulseProfit2,
    pulseOpponentProfit: revealed
      ? you === 1
        ? row.pulseProfit2
        : row.pulseProfit1
      : null,
    serverNow: Date.now(),
  };
}

const settledFor = (userId: string) =>
  and(eq(matches.status, "settled"), or(eq(matches.player1UserId, userId), eq(matches.player2UserId, userId)));

/** Newest-first settled matches a Clerk user played in — the profile Matches tab. */
export async function settledMatchesFor(userId: string, limit = 20): Promise<MatchRow[]> {
  return getDb().select().from(matches).where(settledFor(userId)).orderBy(desc(matches.createdAt)).limit(limit);
}

/** Lifetime W/L/T and net Embers across every settled match, not just the listed page. */
export type MatchRecord = { played: number; won: number; lost: number; tied: number; net: number };

export async function matchRecordFor(userId: string): Promise<MatchRecord> {
  const won = sql`((${matches.winner} = '1' AND ${matches.player1UserId} = ${userId}) OR (${matches.winner} = '2' AND ${matches.player2UserId} = ${userId}))`;
  const tied = sql`${matches.winner} = 'tie'`;
  const [row] = await getDb()
    .select({
      played: sql<number>`count(*)::int`,
      won: sql<number>`(count(*) FILTER (WHERE ${won}))::int`,
      tied: sql<number>`(count(*) FILTER (WHERE ${tied}))::int`,
      net: sql<number>`coalesce(sum(CASE WHEN ${won} THEN ${matches.wager} WHEN ${tied} THEN 0 ELSE -${matches.wager} END), 0)::int`,
    })
    .from(matches)
    .where(settledFor(userId));
  const played = row?.played ?? 0;
  const wins = row?.won ?? 0;
  const ties = row?.tied ?? 0;
  return { played, won: wins, lost: played - wins - ties, tied: ties, net: row?.net ?? 0 };
}

/**
 * Per-market accuracy for the profile hero: a round counts as a call when
 * you finished it with non-zero P&L, and as right when that P&L was positive
 * (Pulse leverage/side are cleared at settlement, so P&L is what's left).
 */
export async function marketAccuracyFor(userId: string): Promise<{ market: string; right: number; calls: number }[]> {
  const profit = sql`CASE WHEN ${matches.player1UserId} = ${userId} THEN ${matches.pulseProfit1} ELSE ${matches.pulseProfit2} END`;
  return getDb()
    .select({
      market: matches.market,
      right: sql<number>`(count(*) FILTER (WHERE ${profit} > 0))::int`,
      calls: sql<number>`(count(*) FILTER (WHERE ${profit} <> 0))::int`,
    })
    .from(matches)
    .where(settledFor(userId))
    .groupBy(matches.market);
}

/** Settled matches by id that the user played in — pinned highlights, which may be older than the listed page. */
export async function settledMatchesByIds(userId: string, ids: string[]): Promise<MatchRow[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(matches).where(and(inArray(matches.id, ids), settledFor(userId)));
}

/** One settled match from one player's side, safe to hand to the client. */
export type MatchHistoryEntry = {
  id: string;
  market: string;
  timerSeconds: number;
  wager: number;
  playedAt: number;
  result: "won" | "lost" | "tie";
  /** Embers back from the wager net of the stake: +wager won, −wager lost, 0 tie (settleFundsIfNeeded). */
  net: number;
  yourProfit: number | null;
  opponentProfit: number | null;
  opponentUserId: string | null;
};

export function historyEntryFor(row: MatchRow, userId: string): MatchHistoryEntry {
  const you = row.player1UserId === userId ? 1 : 2;
  const result = row.winner === "tie" ? "tie" : row.winner === String(you) ? "won" : "lost";
  return {
    id: row.id,
    market: row.market,
    timerSeconds: row.timerSeconds,
    wager: row.wager,
    playedAt: (row.roundStartAt ?? row.createdAt).getTime(),
    result,
    net: result === "won" ? row.wager : result === "lost" ? -row.wager : 0,
    yourProfit: you === 1 ? row.pulseProfit1 : row.pulseProfit2,
    opponentProfit: you === 1 ? row.pulseProfit2 : row.pulseProfit1,
    opponentUserId: you === 1 ? row.player2UserId : row.player1UserId,
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
