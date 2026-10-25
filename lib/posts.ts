import { and, count, desc, eq, gte, ilike, inArray, isNull, notExists, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { pollVotes, postMedia, postViews, posts, profiles } from "@/db/schema";
import { gifById, type GifId } from "@/app/lib/gifs";
import type { Post, PostImage } from "@/app/lib/posts";
import { playedLabel } from "@/app/lib/playedLabel";
import { rankForHandle } from "@/app/lib/rank";
import { isCustomTopicId, isTopicId, type CustomTopicId } from "@/app/lib/topics";
import type { PostInput } from "@/lib/postInput";
import { tradeKey, tradeReceiptsFor } from "@/lib/trades";

// Saved omens (db/schema.ts posts / post_media / poll_votes). Writes come from
// POST /api/posts after app-level validation (lib/postInput.ts); reads turn
// rows into the feed's `Post` shape, resolving every trade ref live through
// lib/trades.ts so a card's numbers always come from the DB, never the post.

type PostRow = typeof posts.$inferSelect;

export type NewPost = PostInput & {
  authorId: string;
  authorName: string;
  authorHandle: string | null;
  tradeRoiAtPost: number | null;
};

/** Inserts the post and its photos in one batch (a neon-http transaction). */
export async function createPost(input: NewPost): Promise<string> {
  const id = crypto.randomUUID();
  const db = getDb();
  const insertPost = db.insert(posts).values({
    id,
    authorId: input.authorId,
    authorName: input.authorName,
    authorHandle: input.authorHandle,
    content: input.content,
    topics: input.topics,
    tradeRef: input.tradeRef,
    tradeRoiAtPost: input.tradeRoiAtPost,
    gif: input.gif,
    pollChoices: input.poll?.choices ?? null,
    pollEndsAt: input.poll ? new Date(Date.now() + input.poll.durationMs) : null,
  });
  if (input.photos.length === 0) {
    await insertPost;
  } else {
    const media = input.photos.map((photo, position) => ({
      postId: id,
      position,
      mime: photo.mime,
      image: photo.base64,
      width: photo.width,
      height: photo.height,
    }));
    await db.batch([insertPost, db.insert(postMedia).values(media)]);
  }
  return id;
}

/** How many posts this author has made since `since` — the posting rate limit. */
export async function postCountSince(authorId: string, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(posts)
    .where(and(eq(posts.authorId, authorId), gte(posts.createdAt, since)));
  return row?.n ?? 0;
}

/** Soft-deletes the author's own post; false when it isn't theirs or is already gone. */
export async function deletePost(id: string, authorId: string): Promise<boolean> {
  const rows = await getDb()
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, id), eq(posts.authorId, authorId), isNull(posts.deletedAt)))
    .returning({ id: posts.id });
  return rows.length > 0;
}

export type VoteResult = "ok" | "not-found" | "closed" | "invalid-choice";

/** Sets (or with `choice` null, clears) the user's vote on a live poll. */
export async function votePoll(postId: string, userId: string, choice: number | null): Promise<VoteResult> {
  const db = getDb();
  const [post] = await db
    .select({ choices: posts.pollChoices, endsAt: posts.pollEndsAt })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  if (!post?.choices || !post.endsAt) return "not-found";
  if (post.endsAt.getTime() <= Date.now()) return "closed";
  if (choice === null) {
    await db.delete(pollVotes).where(and(eq(pollVotes.postId, postId), eq(pollVotes.userId, userId)));
    return "ok";
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= post.choices.length) return "invalid-choice";
  await db
    .insert(pollVotes)
    .values({ postId, userId, choice })
    .onConflictDoUpdate({ target: [pollVotes.postId, pollVotes.userId], set: { choice, createdAt: new Date() } });
  return "ok";
}

/** One photo's bytes, for GET /api/posts/[id]/media/[n]; null once the post is deleted. */
export async function postImage(postId: string, position: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await getDb()
    .select({ mime: postMedia.mime, image: postMedia.image })
    .from(postMedia)
    .innerJoin(posts, eq(posts.id, postMedia.postId))
    .where(and(eq(postMedia.postId, postId), eq(postMedia.position, position), isNull(posts.deletedAt)));
  return row ? { mime: row.mime, bytes: Buffer.from(row.image, "base64") } : null;
}

// "23h" / "6d" / "12m" until a poll closes.
function timeLeft(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.ceil(hours / 24)}d`;
}

/**
 * Rows → feed posts, as `viewerId` sees them: live author name/handle from
 * `profiles` (else the write-time snapshot; a handle only ever comes from
 * `profiles`, where it's unique), photo URLs (never bytes), poll counts plus
 * the viewer's vote, and each trade resolved live — or flagged unavailable.
 */
async function toFeedPosts(rows: PostRow[], viewerId: string | null): Promise<Post[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((row) => row.id);
  const authorIds = [...new Set(rows.map((row) => row.authorId))];
  const pollIds = rows.filter((row) => row.pollChoices).map((row) => row.id);
  const [authors, media, tallies, mine, trades] = await Promise.all([
    db.select({ userId: profiles.userId, displayName: profiles.displayName, handle: profiles.handle }).from(profiles).where(inArray(profiles.userId, authorIds)),
    db
      .select({ postId: postMedia.postId, position: postMedia.position, width: postMedia.width, height: postMedia.height })
      .from(postMedia)
      .where(inArray(postMedia.postId, ids))
      .orderBy(postMedia.position),
    pollIds.length
      ? db.select({ postId: pollVotes.postId, choice: pollVotes.choice, n: count() }).from(pollVotes).where(inArray(pollVotes.postId, pollIds)).groupBy(pollVotes.postId, pollVotes.choice)
      : Promise.resolve([]),
    pollIds.length && viewerId
      ? db.select({ postId: pollVotes.postId, choice: pollVotes.choice }).from(pollVotes).where(and(inArray(pollVotes.postId, pollIds), eq(pollVotes.userId, viewerId)))
      : Promise.resolve([]),
    tradeReceiptsFor(rows.flatMap((row) => (row.tradeRef ? [{ authorId: row.authorId, ref: row.tradeRef }] : []))),
  ]);

  const now = Date.now();
  return rows.map((row) => {
    const profile = authors.find((author) => author.userId === row.authorId);
    const name = profile?.displayName ?? row.authorName;
    const handle = profile?.handle ?? row.authorHandle;
    const trade = row.tradeRef ? trades.get(tradeKey(row.authorId, row.tradeRef)) : undefined;
    const photos: PostImage[] = media
      .filter((item) => item.postId === row.id)
      .map((item) => ({ kind: "photo", src: `/api/posts/${row.id}/media/${item.position}`, width: item.width, height: item.height, alt: `Image ${item.position + 1} attached by ${name}` }));
    const gif = row.gif as GifId | null;
    const post: Post = {
      id: row.id,
      author: name,
      handle: handle ? `@${handle}` : "",
      avatarInitial: name[0]?.toUpperCase() ?? "?",
      content: row.content,
      timestamp: playedLabel(row.createdAt.getTime(), now),
      likes: 0,
      replies: 0,
      kind: "text",
      // Same stub rank the author's profile shows (lib/profile.ts rankForUser).
      rank: rankForHandle(handle),
      saved: true,
      mine: viewerId !== null && row.authorId === viewerId,
      topics: row.topics.filter(isTopicId),
    };
    if (trade) post.trade = trade.open && row.tradeRoiAtPost !== null ? { ...trade, roiAtPost: row.tradeRoiAtPost } : trade;
    else if (row.tradeRef) post.tradeUnavailable = true;
    if (gif) post.media = [{ kind: "gif", gif, alt: `${gifById(gif).caption} GIF` }];
    else if (photos.length > 0) post.media = photos;
    if (row.pollChoices && row.pollEndsAt) {
      const counts = row.pollChoices.map((_, choice) => tallies.find((t) => t.postId === row.id && t.choice === choice)?.n ?? 0);
      const left = row.pollEndsAt.getTime() - now;
      post.poll = {
        choices: row.pollChoices,
        endsIn: left > 0 ? timeLeft(left) : "",
        counts,
        yourVote: mine.find((vote) => vote.postId === row.id)?.choice ?? null,
        closed: left <= 0,
      };
    }
    return post;
  });
}

/** Custom topics on the author's recent posts, newest first — the composer offers them again. */
export async function recentCustomTopicsBy(authorId: string, limit = 20): Promise<CustomTopicId[]> {
  const rows = await getDb()
    .select({ topics: posts.topics })
    .from(posts)
    .where(and(eq(posts.authorId, authorId), isNull(posts.deletedAt)))
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  return [...new Set(rows.flatMap((row) => row.topics).filter(isCustomTopicId))];
}

/**
 * The feed (app/page.tsx): the newest saved posts, plus — signed in — the
 * newest ones `viewerId` hasn't seen yet (lib/postViews.ts), of any age, so
 * For You still has something new when the newest are all seen. Before
 * db/post-views.sql is applied that half is skipped (logged).
 */
export async function feedPosts(viewerId: string | null, limit = 30): Promise<Post[]> {
  const db = getDb();
  const [newest, unseen] = await Promise.all([
    db.select().from(posts).where(isNull(posts.deletedAt)).orderBy(desc(posts.createdAt)).limit(limit),
    viewerId
      ? db
          .select()
          .from(posts)
          .where(and(
            isNull(posts.deletedAt),
            notExists(db.select({ postId: postViews.postId }).from(postViews).where(and(eq(postViews.userId, viewerId), eq(postViews.postId, posts.id)))),
          ))
          .orderBy(desc(posts.createdAt))
          .limit(limit)
          .catch((error: unknown) => {
            console.error("Unseen posts unavailable", error);
            return [];
          })
      : [],
  ]);
  // Unseen posts outside the newest are older than all of them, so this
  // stays newest first.
  const newestIds = new Set(newest.map((row) => row.id));
  return toFeedPosts([...newest, ...unseen.filter((row) => !newestIds.has(row.id))], viewerId);
}

export type PostMatch = { id: string; author: string; handle: string; content: string; timestamp: string };

/**
 * Live posts whose text, author name or @handle contains `query` (any case),
 * newest first — the rail search (app/api/search/route.ts). Live name/handle
 * from `profiles`, else the write-time snapshot; nothing by `hiddenAuthors`.
 */
export async function searchPosts(query: string, limit: number, hiddenAuthors: Set<string> = new Set()): Promise<PostMatch[]> {
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const name = sql<string>`coalesce(${profiles.displayName}, ${posts.authorName})`;
  const handle = sql<string | null>`coalesce(${profiles.handle}, ${posts.authorHandle})`;
  const rows = await getDb()
    .select({ id: posts.id, author: name, handle, content: posts.content, createdAt: posts.createdAt })
    .from(posts)
    .leftJoin(profiles, eq(profiles.userId, posts.authorId))
    .where(
      and(
        isNull(posts.deletedAt),
        hiddenAuthors.size > 0 ? notInArray(posts.authorId, [...hiddenAuthors]) : undefined,
        or(ilike(posts.content, pattern), ilike(name, pattern), ilike(handle, pattern)),
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    author: row.author,
    handle: row.handle ? `@${row.handle}` : "",
    content: row.content,
    timestamp: playedLabel(row.createdAt.getTime(), now),
  }));
}

/** Uuid-shaped, like the ids createPost (and createReply) make. */
export const isSavedPostId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

/** Saved posts by id, newest first, of any age — skipping unknown, malformed or deleted ids. */
export async function savedPostsByIds(ids: string[], viewerId: string | null): Promise<Post[]> {
  const valid = ids.filter(isSavedPostId);
  if (valid.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(posts)
    .where(and(inArray(posts.id, valid), isNull(posts.deletedAt)))
    .orderBy(desc(posts.createdAt));
  return toFeedPosts(rows, viewerId);
}

/** One saved post for /post/[id]; null for unknown, malformed or deleted ids. */
export async function savedPost(id: string, viewerId: string | null): Promise<Post | null> {
  const [post] = await savedPostsByIds([id], viewerId);
  return post ?? null;
}

/** The author's newest saved posts — their profile's Omens tab. */
export async function postsBy(authorId: string, viewerId: string | null, limit = 30): Promise<Post[]> {
  const rows = await getDb()
    .select()
    .from(posts)
    .where(and(eq(posts.authorId, authorId), isNull(posts.deletedAt)))
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  return toFeedPosts(rows, viewerId);
}
