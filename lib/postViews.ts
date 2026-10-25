import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { postViews, posts } from "@/db/schema";
import { isSavedPostId } from "@/lib/posts";

// Reads/writes for the `post_views` table (db/schema.ts): omens an account
// has seen in a feed, reported by app/lib/seenPosts.ts. The For You feed
// leaves them out (app/page.tsx, app/FeedSwitcher.tsx).

// Most ids one report may carry (POST /api/posts/seen).
export const MAX_SEEN_BATCH = 50;

/** Marks `ids` seen by `userId` — only live saved posts; repeats are no-ops. */
export async function recordPostViews(userId: string, ids: string[]): Promise<void> {
  const valid = [...new Set(ids.filter(isSavedPostId))].slice(0, MAX_SEEN_BATCH);
  if (valid.length === 0) return;
  const db = getDb();
  const live = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(inArray(posts.id, valid), isNull(posts.deletedAt)));
  if (live.length === 0) return;
  await db
    .insert(postViews)
    .values(live.map(({ id }) => ({ userId, postId: id })))
    .onConflictDoNothing();
}

/** Which of `ids` `userId` has already seen. */
export async function seenPostIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ postId: postViews.postId })
    .from(postViews)
    .where(and(eq(postViews.userId, userId), inArray(postViews.postId, ids)));
  return new Set(rows.map((row) => row.postId));
}
