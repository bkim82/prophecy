import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { challenges, matches, profiles } from "@/db/schema";
import { CHALLENGE_TTL_SECONDS, ROUND_JOIN_SECONDS, challengeTerms, type AcceptedChallenge, type IncomingChallenge } from "@/app/lib/challengeRules";
import type { ChallengeCard, ChallengeStatus } from "@/app/lib/messageRules";
import { playedLabel } from "@/app/lib/playedLabel";
import { refundBalance } from "@/lib/balance";
import { presenceCutoff } from "@/lib/match";

// Reads/writes for the `challenges` table (db/schema.ts). Validation and the
// rank gate live in app/profile/challengeActions.ts.
//
// A pending challenge expires CHALLENGE_TTL_SECONDS after it's sent. Reads
// treat older pending rows as gone right away; expireStaleChallenges() then
// flips them to "expired" (before a send, so the one-pending slot frees up,
// and before your sent list loads). Times use the database clock.

const ttl = sql`make_interval(secs => ${CHALLENGE_TTL_SECONDS})`;
const unexpired = gt(challenges.createdAt, sql`now() - ${ttl}`);
const expiresInMs = sql<number>`greatest(0, extract(epoch from (${challenges.createdAt} + ${ttl} - now())) * 1000)::int`;
// An accepted round's window for the challenger to take their seat.
const joinWindow = sql`make_interval(secs => ${ROUND_JOIN_SECONDS})`;

export type ChallengeRow = typeof challenges.$inferSelect;

export type NewChallenge = {
  challengerId: string;
  challengerRank: string;
  targetHandle: string;
  targetUserId: string | null;
  targetRank: string;
  mode: "pulse";
  market: string | null;
  timerSeconds: number | null;
  stake: number;
};

const isUniqueViolation = (error: unknown) => {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
};

/** The new challenge's id, or "duplicate" when a challenge to that handle is already pending (challenges_one_pending). */
export async function createChallenge(challenge: NewChallenge): Promise<{ id: string } | "duplicate"> {
  try {
    const id = crypto.randomUUID();
    await getDb().insert(challenges).values({ id, ...challenge });
    return { id };
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

/** Flips your timed-out pending challenges to "expired". */
export async function expireStaleChallenges(challengerId: string): Promise<void> {
  await getDb()
    .update(challenges)
    .set({ status: "expired" })
    .where(and(eq(challenges.challengerId, challengerId), eq(challenges.status, "pending"), sql`not ${unexpired}`));
}

/**
 * Your pending challenges plus declined/expired ones you haven't cleared, newest first — the own-profile Matches tab.
 * Only ones to accounts: challenges sent to the retired mock traders (no `target_user_id`) never show. Run expireStaleChallenges first.
 */
export async function sentChallengesFrom(challengerId: string): Promise<ChallengeRow[]> {
  return getDb()
    .select()
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), isNotNull(challenges.targetUserId), inArray(challenges.status, ["pending", "declined", "expired"])))
    .orderBy(desc(challenges.createdAt));
}

export type IncomingChallengeRow = ChallengeRow & { challengerHandle: string | null; challengerName: string | null; expiresInMs: number };

/** Unexpired pending challenges sent to you, newest first — the header bell. */
async function incomingChallengesFor(userId: string, limit = 20): Promise<IncomingChallengeRow[]> {
  const rows = await getDb()
    .select({ challenge: challenges, challengerHandle: profiles.handle, challengerName: profiles.displayName, expiresInMs })
    .from(challenges)
    .leftJoin(profiles, eq(profiles.userId, challenges.challengerId))
    .where(and(eq(challenges.targetUserId, userId), eq(challenges.status, "pending"), unexpired))
    .orderBy(desc(challenges.createdAt))
    .limit(limit);
  return rows.map(({ challenge, ...rest }) => ({ ...challenge, ...rest }));
}

/** Your unexpired pending challenge to that handle — the profile's "Challenge sent" state. */
export async function pendingChallengeTo(challengerId: string, targetHandle: string): Promise<(ChallengeRow & { expiresInMs: number }) | null> {
  const [row] = await getDb()
    .select({ challenge: challenges, expiresInMs })
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), eq(challenges.targetHandle, targetHandle), eq(challenges.status, "pending"), unexpired));
  return row ? { ...row.challenge, expiresInMs: row.expiresInMs } : null;
}

/** incomingChallengesFor as the header bell shows them (POST /api/presence). */
export async function incomingChallengeViews(userId: string): Promise<IncomingChallenge[]> {
  const now = Date.now();
  return (await incomingChallengesFor(userId)).map((row) => ({
    id: row.id,
    handle: row.challengerHandle ? `@${row.challengerHandle}` : null,
    name: row.challengerName ?? row.challengerHandle ?? "A trader",
    rank: row.challengerRank,
    mode: row.mode,
    market: row.market,
    timerSeconds: row.timerSeconds,
    stake: row.stake,
    sentLabel: playedLabel(row.createdAt.getTime(), now),
    expiresInMs: row.expiresInMs,
  }));
}

// Stored status → what a conversation's card says. A pending row past its TTL has expired.
const CARD_STATUS: Record<string, ChallengeStatus> = { pending: "pending", accepted: "accepted", declined: "declined", expired: "expired", canceled: "canceled", dismissed: "closed" };

/** Challenges as their cards in a conversation show them (lib/messages.ts), by id. */
export async function challengeCardsFor(ids: string[]): Promise<Map<string, ChallengeCard>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ challenge: challenges, live: sql<boolean>`${unexpired}`, expiresInMs })
    .from(challenges)
    .where(inArray(challenges.id, ids));
  return new Map(
    rows.map(({ challenge, live, expiresInMs: left }) => {
      const status = challenge.status === "pending" && !live ? "expired" : (CARD_STATUS[challenge.status] ?? "closed");
      return [challenge.id, { id: challenge.id, mode: challenge.mode, terms: challengeTerms(challenge), status, expiresInMs: status === "pending" ? left : 0 }];
    }),
  );
}

/** A challenge sent to you that's still pending (`expired` once it timed out); null if it isn't (or isn't yours). */
export async function pendingChallengeFor(targetUserId: string, id: string): Promise<(ChallengeRow & { expired: boolean }) | null> {
  const [row] = await getDb()
    .select({ challenge: challenges, expired: sql<boolean>`not ${unexpired}` })
    .from(challenges)
    .where(and(eq(challenges.id, id), eq(challenges.targetUserId, targetUserId), eq(challenges.status, "pending")));
  return row ? { ...row.challenge, expired: row.expired } : null;
}

/**
 * Accepting a Pulse challenge: opens its private round with the accepter in
 * seat 1 (their stake already reserved by the caller), then marks the
 * challenge accepted. Only the challenger may take seat 2 (`invited_user_id`).
 * Null when the challenge stopped being pending first — the round is removed
 * again and the caller refunds.
 */
export async function openChallengeRound(
  challenge: ChallengeRow & { market: string; timerSeconds: number },
  host: { userId: string; playerId: string },
): Promise<string | null> {
  const db = getDb();
  const matchId = crypto.randomUUID();
  await db.insert(matches).values({
    id: matchId,
    market: challenge.market,
    mode: "pulse",
    wager: challenge.stake,
    timerSeconds: challenge.timerSeconds,
    status: "open",
    player1Id: host.playerId,
    player1UserId: host.userId,
    player1LastSeen: new Date(),
    invitedUserId: challenge.challengerId,
  });
  const claimed = await db
    .update(challenges)
    .set({ status: "accepted", matchId })
    .where(and(eq(challenges.id, challenge.id), eq(challenges.targetUserId, host.userId), eq(challenges.status, "pending"), unexpired))
    .returning({ id: challenges.id });
  if (claimed.length > 0) return matchId;
  await db.delete(matches).where(eq(matches.id, matchId));
  return null;
}

/**
 * Your challenges that were accepted and whose private round is still waiting
 * for you, with the accepter still in it and inside the join window — the
 * bell's "Join round" popup.
 */
export async function acceptedChallengeViews(challengerId: string): Promise<AcceptedChallenge[]> {
  const rows = await getDb()
    .select({ challenge: challenges, handle: profiles.handle, name: profiles.displayName })
    .from(challenges)
    .innerJoin(matches, eq(matches.id, challenges.matchId))
    .leftJoin(profiles, eq(profiles.userId, challenges.targetUserId))
    .where(
      and(
        eq(challenges.challengerId, challengerId),
        eq(challenges.status, "accepted"),
        eq(matches.status, "open"),
        isNull(matches.player2Id),
        eq(matches.invitedUserId, challengerId),
        gt(matches.player1LastSeen, presenceCutoff()),
        gt(matches.createdAt, sql`now() - ${joinWindow}`),
      ),
    )
    .orderBy(desc(matches.createdAt));
  return rows.map(({ challenge, handle, name }) => ({
    id: challenge.id,
    handle: handle ? `@${handle}` : null,
    name: name ?? handle ?? challenge.targetHandle,
    mode: challenge.mode,
    market: challenge.market,
    timerSeconds: challenge.timerSeconds,
    stake: challenge.stake,
    href: `/duel/${challenge.market}/pulse/${challenge.matchId}?invite=1`,
  }));
}

/**
 * Closes challenge rounds you're in (as accepter or invited challenger) that
 * nobody will play: the challenger didn't join within ROUND_JOIN_SECONDS, or
 * the accepter stopped polling the room (left the page) for longer than the
 * match presence window. Refunds the accepter's stake — the challenger's
 * isn't reserved until they join. Run off every heartbeat, so whichever of
 * the two is still around cleans up.
 */
export async function closeAbandonedRounds(userId: string): Promise<void> {
  const closed = await getDb()
    .delete(matches)
    .where(
      and(
        eq(matches.status, "open"),
        isNull(matches.player2Id),
        isNotNull(matches.invitedUserId),
        or(eq(matches.player1UserId, userId), eq(matches.invitedUserId, userId)),
        or(lt(matches.player1LastSeen, presenceCutoff()), lt(matches.createdAt, sql`now() - ${joinWindow}`)),
      ),
    )
    .returning({ hostUserId: matches.player1UserId, wager: matches.wager });
  await Promise.all(closed.map(({ hostUserId, wager }) => (hostUserId ? refundBalance(hostUserId, wager) : null)));
}

/** Guarded on target + still pending and unexpired; false when there was nothing to decline. */
export async function declinePendingChallenge(targetUserId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(challenges)
    .set({ status: "declined" })
    .where(and(eq(challenges.id, id), eq(challenges.targetUserId, targetUserId), eq(challenges.status, "pending"), unexpired))
    .returning({ id: challenges.id });
  return rows.length > 0;
}

/** Clears a declined or expired challenge from its sender's list; guarded on owner + status. */
export async function dismissDeclinedChallenge(challengerId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(challenges)
    .set({ status: "dismissed" })
    .where(and(eq(challenges.id, id), eq(challenges.challengerId, challengerId), inArray(challenges.status, ["declined", "expired"])))
    .returning({ id: challenges.id });
  return rows.length > 0;
}

/** Guarded on owner + still pending; false when there was nothing to cancel. */
export async function cancelPendingChallenge(challengerId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(challenges)
    .set({ status: "canceled" })
    .where(and(eq(challenges.id, id), eq(challenges.challengerId, challengerId), eq(challenges.status, "pending")))
    .returning({ id: challenges.id });
  return rows.length > 0;
}
