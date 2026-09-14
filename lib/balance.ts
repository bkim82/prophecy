import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matchPayouts, users } from "@/db/schema";

export const INITIAL_BALANCE = 1000;

export async function ensureUser(userId: string) {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ id: userId })
    .onConflictDoNothing()
    .returning();
  if (user) return user;
  const [existing] = await db.select().from(users).where(eq(users.id, userId));
  return existing ?? null;
}

/** Atomically reserves coins, so two tabs cannot spend the same balance. */
export async function reserveBalance(userId: string, amount: number) {
  await ensureUser(userId);
  const [updated] = await getDb()
    .update(users)
    .set({ balance: sql`${users.balance} - ${amount}` })
    .where(and(eq(users.id, userId), gte(users.balance, amount)))
    .returning({ balance: users.balance });
  return updated ?? null;
}

export async function refundBalance(userId: string, amount: number) {
  await getDb()
    .update(users)
    .set({ balance: sql`${users.balance} + ${amount}` })
    .where(eq(users.id, userId));
}

/** One SQL statement makes the payout idempotent under competing polls. */
export async function creditPayout(
  matchId: string,
  role: 1 | 2,
  userId: string,
  amount: number,
) {
  await getDb().execute(sql`
    WITH credited AS (
      INSERT INTO ${matchPayouts} (id, match_id, user_id, amount)
      VALUES (${`${matchId}:${role}`}, ${matchId}, ${userId}, ${amount})
      ON CONFLICT (id) DO NOTHING
      RETURNING user_id, amount
    )
    UPDATE ${users}
    SET balance = ${users.balance} + credited.amount
    FROM credited
    WHERE ${users.id} = credited.user_id
  `);
}
