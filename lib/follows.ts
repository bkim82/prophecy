import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { follows, profiles } from "@/db/schema";
import { getProfile } from "@/app/lib/mockProfiles";
import { rankForHandle } from "@/app/lib/rank";
import { profileMatchFields, publicProfileFor, type ProfileMatch, type PublicProfile } from "@/lib/profile";

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

// Their follow of you: the other half of a friendship (you follow each other).
const followBack = alias(follows, "follow_back");

/** Which of `userIds` you follow each other with — the Messages dock's inbox rule (app/lib/messageRules.ts). */
export async function friendIdsAmong(userId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ id: follows.target })
    .from(follows)
    .innerJoin(followBack, and(eq(followBack.followerId, follows.target), eq(followBack.target, userId)))
    .where(and(eq(follows.followerId, userId), inArray(follows.target, userIds)));
  return new Set(rows.map((row) => row.id));
}

/** Accounts with a handle you follow each other with, most recently followed first — New message's suggestions. */
export async function friendAccounts(userId: string, limit: number): Promise<ProfileMatch[]> {
  const rows = await getDb()
    .select(profileMatchFields())
    .from(follows)
    .innerJoin(followBack, and(eq(followBack.followerId, follows.target), eq(followBack.target, userId)))
    .innerJoin(profiles, eq(profiles.userId, follows.target))
    .where(and(eq(follows.followerId, userId), isNotNull(profiles.handle)))
    .orderBy(desc(follows.createdAt))
    .limit(limit);
  return rows.flatMap(({ handle, ...row }) => (handle ? [{ ...row, handle }] : []));
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
