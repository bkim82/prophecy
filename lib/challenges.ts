import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { challenges, profiles } from "@/db/schema";
import type { ChallengeMode } from "@/app/lib/challengeRules";

// Reads/writes for the `challenges` table (db/schema.ts). Validation and the
// rank gate live in app/profile/challengeActions.ts.

export type ChallengeRow = typeof challenges.$inferSelect;

export type NewChallenge = {
  challengerId: string;
  challengerRank: string;
  targetHandle: string;
  targetUserId: string | null;
  targetRank: string;
  mode: ChallengeMode;
  market: string | null;
  timerSeconds: number | null;
  stake: number;
};

const isUniqueViolation = (error: unknown) => {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
};

/** "duplicate" when a challenge to that handle is already pending (challenges_one_pending). */
export async function createChallenge(challenge: NewChallenge): Promise<"ok" | "duplicate"> {
  try {
    await getDb().insert(challenges).values({ id: crypto.randomUUID(), ...challenge });
    return "ok";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

/** Your pending challenges plus declined ones you haven't cleared, newest first — the own-profile Matches tab. */
export async function sentChallengesFrom(challengerId: string): Promise<ChallengeRow[]> {
  return getDb()
    .select()
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), inArray(challenges.status, ["pending", "declined"])))
    .orderBy(desc(challenges.createdAt));
}

export type IncomingChallengeRow = ChallengeRow & { challengerHandle: string | null; challengerName: string | null };

/** Pending challenges sent to you, newest first — the header bell. */
export async function incomingChallengesFor(userId: string, limit = 20): Promise<IncomingChallengeRow[]> {
  const rows = await getDb()
    .select({ challenge: challenges, challengerHandle: profiles.handle, challengerName: profiles.displayName })
    .from(challenges)
    .leftJoin(profiles, eq(profiles.userId, challenges.challengerId))
    .where(and(eq(challenges.targetUserId, userId), eq(challenges.status, "pending")))
    .orderBy(desc(challenges.createdAt))
    .limit(limit);
  return rows.map(({ challenge, challengerHandle, challengerName }) => ({ ...challenge, challengerHandle, challengerName }));
}

export async function pendingChallengeTo(challengerId: string, targetHandle: string): Promise<ChallengeRow | null> {
  const [row] = await getDb()
    .select()
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), eq(challenges.targetHandle, targetHandle), eq(challenges.status, "pending")));
  return row ?? null;
}

/** Guarded on target + still pending; false when there was nothing to decline. */
export async function declinePendingChallenge(targetUserId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(challenges)
    .set({ status: "declined" })
    .where(and(eq(challenges.id, id), eq(challenges.targetUserId, targetUserId), eq(challenges.status, "pending")))
    .returning({ id: challenges.id });
  return rows.length > 0;
}

/** Clears a declined challenge from its sender's list; guarded on owner + declined. */
export async function dismissDeclinedChallenge(challengerId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .update(challenges)
    .set({ status: "dismissed" })
    .where(and(eq(challenges.id, id), eq(challenges.challengerId, challengerId), eq(challenges.status, "declined")))
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
