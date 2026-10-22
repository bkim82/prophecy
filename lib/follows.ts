import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { follows, profiles } from "@/db/schema";
import { getProfile } from "@/app/lib/mockProfiles";
import { rankForHandle } from "@/app/lib/rank";
import { publicProfileFor, type PublicProfile } from "@/lib/profile";

// Reads/writes for the `follows` table (db/schema.ts). Nothing is seeded: a
// new account follows no one and has no followers until people follow it.

// Someone you can follow or challenge. Mock traders are keyed by "@handle"
// and never follow back; real accounts (any with a handle) by user id, with
// rankForHandle() as their rank, and `account` for their page.
export type FollowTarget = { key: string; userId: string | null; handle: string; name: string; rank: string; account: PublicProfile | null };

/** `handle` as in the URL or a form: "@nova_trades", "@Sam". */
export async function followTarget(handle: string): Promise<FollowTarget | null> {
  const mock = getProfile(handle);
  if (mock) return { key: mock.handle, userId: null, handle: mock.handle, name: mock.name, rank: mock.rank, account: null };
  const account = await publicProfileFor(handle.replace(/^@/, "").toLowerCase());
  if (!account) return null;
  const { userId, displayName } = account;
  return { key: userId, userId, handle: `@${account.handle}`, name: displayName ?? account.handle, rank: rankForHandle(account.handle), account };
}

export async function isFollowing(followerId: string, target: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ target: follows.target })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.target, target)));
  return Boolean(row);
}

/** Everyone you follow as "@handle"s — mock traders and real accounts — for the feed's Following filter. */
export async function followedHandles(followerId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ target: follows.target, handle: profiles.handle })
    .from(follows)
    .leftJoin(profiles, eq(profiles.userId, follows.target))
    .where(eq(follows.followerId, followerId));
  return rows.flatMap((row) => (row.target.startsWith("@") ? [row.target] : row.handle ? [`@${row.handle}`] : []));
}

export async function followerCount(target: string): Promise<number> {
  const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.target, target));
  return row?.count ?? 0;
}

export async function followingCount(followerId: string): Promise<number> {
  const [row] = await getDb().select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, followerId));
  return row?.count ?? 0;
}

export async function saveFollow(followerId: string, target: string, following: boolean): Promise<void> {
  if (following) {
    await getDb().insert(follows).values({ followerId, target }).onConflictDoNothing();
  } else {
    await getDb().delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.target, target)));
  }
}
