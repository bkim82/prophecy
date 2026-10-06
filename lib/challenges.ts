import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { challenges } from "@/db/schema";
import type { ChallengeMode } from "@/app/lib/challengeRules";

// Reads/writes for the `challenges` table (db/schema.ts). Validation and the
// rank gate live in app/profile/challengeActions.ts.

export type ChallengeRow = typeof challenges.$inferSelect;

export type NewChallenge = {
  challengerId: string;
  challengerRank: string;
  targetHandle: string;
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

/** Your pending challenges, newest first — the own-profile Matches tab. */
export async function pendingChallengesFrom(challengerId: string): Promise<ChallengeRow[]> {
  return getDb()
    .select()
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), eq(challenges.status, "pending")))
    .orderBy(desc(challenges.createdAt));
}

export async function pendingChallengeTo(challengerId: string, targetHandle: string): Promise<ChallengeRow | null> {
  const [row] = await getDb()
    .select()
    .from(challenges)
    .where(and(eq(challenges.challengerId, challengerId), eq(challenges.targetHandle, targetHandle), eq(challenges.status, "pending")));
  return row ?? null;
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
