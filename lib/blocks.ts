import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, challenges, follows, postReshares, posts, profiles } from "@/db/schema";

// Reads/writes for the `blocks` table (db/schema.ts). Real accounts only, by
// user id. A block either way counts for both people: no direct messages, no
// follows, no conversation in either dock, no saved posts in either feed, no
// replies to or reposts of each other's posts, and each other's replies and
// reposts left out of what you see (lib/engagement.ts).

// What a profile shows: you blocked them (Unblock), they blocked you (a note), or neither.
export type BlockState = { youBlocked: boolean; blockedYou: boolean };

const either = (a: string, b: string) =>
  or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)));

export async function blockStateBetween(userId: string, otherId: string): Promise<BlockState> {
  const rows = await getDb().select({ blockerId: blocks.blockerId }).from(blocks).where(either(userId, otherId));
  return { youBlocked: rows.some((row) => row.blockerId === userId), blockedYou: rows.some((row) => row.blockerId === otherId) };
}

export async function isBlockedEitherWay(userId: string, otherId: string): Promise<boolean> {
  const { youBlocked, blockedYou } = await blockStateBetween(userId, otherId);
  return youBlocked || blockedYou;
}

/** Everyone you've blocked or who's blocked you, by user id. */
export async function blockedIdsFor(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
}

/** blockedIdsFor plus their "@handle"s (accounts without one have none) — saved posts only carry the handle. */
export async function blockedAccountsFor(userId: string): Promise<{ ids: Set<string>; handles: Set<string> }> {
  const ids = await blockedIdsFor(userId);
  if (ids.size === 0) return { ids, handles: new Set() };
  const rows = await getDb().select({ handle: profiles.handle }).from(profiles).where(inArray(profiles.userId, [...ids]));
  return { ids, handles: new Set(rows.flatMap((row) => (row.handle ? [`@${row.handle}`] : []))) };
}

/** The feed hides these authors' saved posts. */
export async function blockedHandlesFor(userId: string): Promise<Set<string>> {
  return (await blockedAccountsFor(userId)).handles;
}

/**
 * Blocking also unfollows both ways (so challenges, which are friends-only,
 * stop too), cancels any challenge still pending between you, and takes back
 * each one's reposts of the other's saved posts so neither's followers keep
 * seeing them. Replies stay for everyone else. Unblocking restores none of it.
 */
export async function saveBlock(blockerId: string, blockedId: string, blocked: boolean): Promise<void> {
  const db = getDb();
  if (!blocked) {
    await db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
    return;
  }
  const repostsOf = (resharerId: string, authorId: string) =>
    and(eq(postReshares.userId, resharerId), inArray(postReshares.postId, db.select({ id: posts.id }).from(posts).where(eq(posts.authorId, authorId))));
  await Promise.all([
    db.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing(),
    db.delete(postReshares).where(or(repostsOf(blockedId, blockerId), repostsOf(blockerId, blockedId))),
    db.delete(follows).where(
      or(and(eq(follows.followerId, blockerId), eq(follows.target, blockedId)), and(eq(follows.followerId, blockedId), eq(follows.target, blockerId))),
    ),
    db
      .update(challenges)
      .set({ status: "canceled" })
      .where(
        and(
          eq(challenges.status, "pending"),
          or(
            and(eq(challenges.challengerId, blockerId), eq(challenges.targetUserId, blockedId)),
            and(eq(challenges.challengerId, blockedId), eq(challenges.targetUserId, blockerId)),
          ),
        ),
      ),
  ]);
}
