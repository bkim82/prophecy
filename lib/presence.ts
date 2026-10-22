import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { presence } from "@/db/schema";

// Reads/writes for the `presence` table (db/schema.ts). Times come from the
// database clock, so app servers' clocks never disagree about who's online.

// The header heartbeat runs every 2s in a visible tab and every 15s in a
// background one (app/LiveChallenges.tsx); browsers slow background tabs'
// timers to once a minute, so allow 90s.
export const ONLINE_WINDOW = sql`interval '90 seconds'`;

/** Marks you online. Writes at most every 10s however fast the heartbeat runs. */
export async function touchPresence(userId: string): Promise<void> {
  await getDb()
    .insert(presence)
    .values({ userId, lastSeenAt: sql`now()` })
    .onConflictDoUpdate({
      target: presence.userId,
      set: { lastSeenAt: sql`now()` },
      setWhere: lt(presence.lastSeenAt, sql`now() - interval '10 seconds'`),
    });
}

/** The tab closed: offline now rather than when the window runs out. */
export async function clearPresence(userId: string): Promise<void> {
  await getDb().delete(presence).where(eq(presence.userId, userId));
}

export async function isOnline(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ userId: presence.userId })
    .from(presence)
    .where(and(eq(presence.userId, userId), gt(presence.lastSeenAt, sql`now() - ${ONLINE_WINDOW}`)));
  return Boolean(row);
}
