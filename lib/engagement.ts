import { and, count, desc, eq, gte, inArray, isNull, notInArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { clashVotes, follows, postLikes, postReplies, postReshares, posts, profiles, replyLikes } from "@/db/schema";
import { EXCLUSIVE_POSTS, GLOBAL_POSTS, POST_REPLIES, type Clash, type Post, type Reply, type Share } from "@/app/lib/mockPosts";
import type { ProfileActivity, ProfileComment } from "@/app/lib/mockProfiles";
import { playedLabel } from "@/app/lib/playedLabel";
import type { Reshare, ReshareKind } from "@/app/PostShare";
import { blockedAccountsFor, blockedIdsFor } from "@/lib/blocks";
import { isSavedPostId, postsBy, savedPostsByIds } from "@/lib/posts";

// Likes, reposts (repost / vouch / defy), replies and clash votes on omens
// (db/schema.ts post_likes / post_reshares / post_replies / reply_likes /
// clash_votes), written by the /api/posts/[id]/… routes. They work on saved
// posts and on the mock feed alike: a mock post's hand-written counts are the
// base the saved engagement is added to.

type ReplyRow = typeof postReplies.$inferSelect;

const MOCK_POSTS = new Map([...GLOBAL_POSTS, ...EXCLUSIVE_POSTS].map((post) => [post.id, post]));

// Leaves out rows by anyone with a block either way with the viewer (lib/blocks.ts) — nothing to leave out for most viewers.
const notBy = (column: PgColumn, blocked: Set<string>): SQL | undefined => (blocked.size > 0 ? notInArray(column, [...blocked]) : undefined);
const NO_BLOCKS = { ids: new Set<string>(), handles: new Set<string>() };

// Streak, promo and clash cards have no like / comment / repost row.
const engageable = (post: Post) => post.kind !== "streak" && post.kind !== "promo" && post.kind !== "clash";
const isClash = (post: Post): post is Post & { clash: Clash } => post.kind === "clash" && post.clash !== undefined;

export const isReshareKind = (value: unknown): value is ReshareKind => value === "repost" || value === "vouch" || value === "defy";

/**
 * A post that takes likes, reposts and replies: a live saved post (with its
 * author, so they can't vouch for or defy their own) or an engageable mock
 * post (no author). Null for anything else.
 */
export async function engagementTarget(postId: string): Promise<{ authorId: string | null } | null> {
  const mock = MOCK_POSTS.get(postId);
  if (mock) return engageable(mock) ? { authorId: null } : null;
  if (!isSavedPostId(postId)) return null;
  const [row] = await getDb()
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  return row ?? null;
}

export async function setLike(postId: string, userId: string, liked: boolean): Promise<void> {
  const db = getDb();
  if (liked) await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
  else await db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)));
}

/** Sets the user's one repost of a post (kind + words), or with null undoes it. */
export async function setReshare(postId: string, userId: string, reshare: Reshare | null): Promise<void> {
  const db = getDb();
  if (!reshare) {
    await db.delete(postReshares).where(and(eq(postReshares.postId, postId), eq(postReshares.userId, userId)));
    return;
  }
  const { kind, text } = reshare;
  await db
    .insert(postReshares)
    .values({ postId, userId, kind, text })
    .onConflictDoUpdate({ target: [postReshares.postId, postReshares.userId], set: { kind, text, createdAt: new Date() } });
}

/** Sets (or with `side` null, takes back) the user's side on a mock clash; false when `postId` isn't one. */
export async function voteClash(postId: string, userId: string, side: 0 | 1 | null): Promise<boolean> {
  if (MOCK_POSTS.get(postId)?.kind !== "clash") return false;
  const db = getDb();
  if (side === null) {
    await db.delete(clashVotes).where(and(eq(clashVotes.postId, postId), eq(clashVotes.userId, userId)));
  } else {
    await db
      .insert(clashVotes)
      .values({ postId, userId, side })
      .onConflictDoUpdate({ target: [clashVotes.postId, clashVotes.userId], set: { side, createdAt: new Date() } });
  }
  return true;
}

/**
 * Adds saved likes, reposts, replies and clash votes to each post's counts,
 * plus the viewer's own: `liked`, `yourReshare` and a clash's `yourVote`.
 * Replies and reposts by anyone with a block either way with the viewer
 * aren't counted (repliesFor doesn't show them either), and saved posts by
 * them get `blocked` — no replying or reposting. Before db/engagement.sql is
 * applied, or during a DB outage, posts keep their own counts.
 */
export async function withEngagement(list: Post[], viewerId: string | null): Promise<Post[]> {
  const ids = [...new Set(list.filter(engageable).map((post) => post.id))];
  const clashIds = [...new Set(list.filter(isClash).map((post) => post.id))];
  if (ids.length === 0 && clashIds.length === 0) return list;
  const db = getDb();
  // inArray needs at least one id; the viewer's own rows only when signed in.
  const whenAny = <T,>(some: unknown[], query: () => Promise<T[]>) => (some.length ? query() : Promise.resolve([] as T[]));
  const viewer = viewerId ?? "";
  try {
    // Before db/blocks.sql is applied there's nothing to leave out.
    const blocked = viewerId ? await blockedAccountsFor(viewerId).catch(() => NO_BLOCKS) : NO_BLOCKS;
    const [likes, liked, reshares, yours, replies, sides, votes] = await Promise.all([
      whenAny(ids, () => db.select({ postId: postLikes.postId, n: count() }).from(postLikes).where(inArray(postLikes.postId, ids)).groupBy(postLikes.postId)),
      whenAny(viewerId ? ids : [], () =>
        db.select({ postId: postLikes.postId }).from(postLikes).where(and(inArray(postLikes.postId, ids), eq(postLikes.userId, viewer))),
      ),
      whenAny(ids, () =>
        db
          .select({ postId: postReshares.postId, kind: postReshares.kind, n: count() })
          .from(postReshares)
          .where(and(inArray(postReshares.postId, ids), notBy(postReshares.userId, blocked.ids)))
          .groupBy(postReshares.postId, postReshares.kind),
      ),
      whenAny(viewerId ? ids : [], () =>
        db
          .select({ postId: postReshares.postId, kind: postReshares.kind, text: postReshares.text, createdAt: postReshares.createdAt })
          .from(postReshares)
          .where(and(inArray(postReshares.postId, ids), eq(postReshares.userId, viewer))),
      ),
      whenAny(ids, () =>
        db
          .select({ postId: postReplies.postId, n: count() })
          .from(postReplies)
          .where(and(inArray(postReplies.postId, ids), isNull(postReplies.deletedAt), notBy(postReplies.authorId, blocked.ids)))
          .groupBy(postReplies.postId),
      ),
      whenAny(clashIds, () =>
        db
          .select({ postId: clashVotes.postId, side: clashVotes.side, n: count() })
          .from(clashVotes)
          .where(inArray(clashVotes.postId, clashIds))
          .groupBy(clashVotes.postId, clashVotes.side),
      ),
      whenAny(viewerId ? clashIds : [], () =>
        db.select({ postId: clashVotes.postId, side: clashVotes.side }).from(clashVotes).where(and(inArray(clashVotes.postId, clashIds), eq(clashVotes.userId, viewer))),
      ),
    ]);

    const now = Date.now();
    const likedIds = new Set(liked.map((row) => row.postId));
    const tally = (rows: { postId: string; n: number }[], postId: string) => rows.find((row) => row.postId === postId)?.n ?? 0;
    const reshareCount = (postId: string, kind: ReshareKind) => reshares.find((row) => row.postId === postId && row.kind === kind)?.n ?? 0;
    return list.map((post) => {
      if (isClash(post)) {
        const sideVotes = (side: 0 | 1) => post.clash.sides[side].votes + (sides.find((row) => row.postId === post.id && row.side === side)?.n ?? 0);
        const yourVote = votes.find((row) => row.postId === post.id)?.side;
        return {
          ...post,
          clash: {
            ...post.clash,
            sides: [{ ...post.clash.sides[0], votes: sideVotes(0) }, { ...post.clash.sides[1], votes: sideVotes(1) }],
            yourVote: yourVote === 0 || yourVote === 1 ? yourVote : undefined,
          },
        };
      }
      if (!engageable(post)) return post;
      const own = yours.find((row) => row.postId === post.id);
      return {
        ...post,
        likes: post.likes + tally(likes, post.id),
        liked: likedIds.has(post.id),
        replies: post.replies + tally(replies, post.id),
        reposts: (post.reposts ?? 0) + reshareCount(post.id, "repost"),
        vouches: (post.vouches ?? 0) + reshareCount(post.id, "vouch"),
        defies: (post.defies ?? 0) + reshareCount(post.id, "defy"),
        yourReshare: own && isReshareKind(own.kind) ? { kind: own.kind, text: own.text, timestamp: playedLabel(own.createdAt.getTime(), now) } : undefined,
        blocked: post.saved === true && blocked.handles.has(post.handle),
      };
    });
  } catch (error) {
    console.error("Post engagement unavailable", error);
    return list;
  }
}

// How far back reposts by people you follow reach your feed.
const SHARE_WINDOW_MS = 7 * 86_400_000;

/**
 * Reposts (any kind, with their words) made in the last week by real
 * accounts `viewerId` follows, newest first — the feed shows each above its
 * post and pulls it into Following.
 */
export async function followedReshares(viewerId: string, limit = 50): Promise<Share[]> {
  const rows = await getDb()
    .select({
      postId: postReshares.postId,
      kind: postReshares.kind,
      text: postReshares.text,
      createdAt: postReshares.createdAt,
      displayName: profiles.displayName,
      handle: profiles.handle,
    })
    .from(postReshares)
    .innerJoin(follows, and(eq(follows.followerId, viewerId), eq(follows.target, postReshares.userId)))
    .innerJoin(profiles, eq(profiles.userId, postReshares.userId))
    .where(gte(postReshares.createdAt, new Date(Date.now() - SHARE_WINDOW_MS)))
    .orderBy(desc(postReshares.createdAt))
    .limit(limit);
  const now = Date.now();
  // Followed accounts always have a handle (lib/follows.ts followTarget).
  return rows.flatMap((row) =>
    row.handle && isReshareKind(row.kind)
      ? [
          {
            id: `saved:${row.postId}:${row.handle}`,
            kind: row.kind,
            postId: row.postId,
            name: row.displayName ?? row.handle,
            handle: `@${row.handle}`,
            timestamp: playedLabel(row.createdAt.getTime(), now),
            text: row.text || undefined,
            saved: true,
          },
        ]
      : [],
  );
}

/** How many replies this author has written since `since` (deleted ones too) — the reply rate limit. */
export async function replyCountSince(authorId: string, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(postReplies)
    .where(and(eq(postReplies.authorId, authorId), gte(postReplies.createdAt, since)));
  return row?.n ?? 0;
}

export type NewReply = { postId: string; authorId: string; authorName: string; authorHandle: string | null; content: string };

/** Saves a reply and returns it as its author now sees it. */
export async function createReply(input: NewReply): Promise<Reply> {
  const id = crypto.randomUUID();
  await getDb().insert(postReplies).values({ id, ...input });
  return {
    id,
    author: input.authorName,
    handle: input.authorHandle ? `@${input.authorHandle}` : "",
    avatarInitial: input.authorName[0]?.toUpperCase() ?? "?",
    content: input.content,
    timestamp: "just now",
    likes: 0,
    saved: true,
    mine: true,
  };
}

/** The author's own live reply under `postId`: new words (marked edited), or deleted. False when it isn't theirs or is gone. */
export async function editReply(postId: string, replyId: string, authorId: string, content: string): Promise<boolean> {
  const rows = await getDb()
    .update(postReplies)
    .set({ content, editedAt: new Date() })
    .where(and(eq(postReplies.id, replyId), eq(postReplies.postId, postId), eq(postReplies.authorId, authorId), isNull(postReplies.deletedAt)))
    .returning({ id: postReplies.id });
  return rows.length > 0;
}

export async function deleteReply(postId: string, replyId: string, authorId: string): Promise<boolean> {
  const rows = await getDb()
    .update(postReplies)
    .set({ deletedAt: new Date() })
    .where(and(eq(postReplies.id, replyId), eq(postReplies.postId, postId), eq(postReplies.authorId, authorId), isNull(postReplies.deletedAt)))
    .returning({ id: postReplies.id });
  return rows.length > 0;
}

/**
 * Saved reply rows (live author name/handle from `profiles`, else the
 * write-time snapshot), then `mock` replies, each with its saved likes added
 * and the viewer's own `liked`; `mine` marks the viewer's saved ones.
 */
async function toReplies(rows: ReplyRow[], mock: Reply[], viewerId: string | null): Promise<Reply[]> {
  const ids = [...rows.map((row) => row.id), ...mock.map((reply) => reply.id)];
  if (ids.length === 0) return [];
  const db = getDb();
  const authorIds = [...new Set(rows.map((row) => row.authorId))];
  const [authors, likes, liked] = await Promise.all([
    authorIds.length
      ? db.select({ userId: profiles.userId, displayName: profiles.displayName, handle: profiles.handle }).from(profiles).where(inArray(profiles.userId, authorIds))
      : Promise.resolve([]),
    db.select({ replyId: replyLikes.replyId, n: count() }).from(replyLikes).where(inArray(replyLikes.replyId, ids)).groupBy(replyLikes.replyId),
    viewerId
      ? db.select({ replyId: replyLikes.replyId }).from(replyLikes).where(and(inArray(replyLikes.replyId, ids), eq(replyLikes.userId, viewerId)))
      : Promise.resolve([]),
  ]);

  const now = Date.now();
  const likedIds = new Set(liked.map((row) => row.replyId));
  const withLikes = (reply: Reply): Reply => ({
    ...reply,
    likes: reply.likes + (likes.find((row) => row.replyId === reply.id)?.n ?? 0),
    liked: likedIds.has(reply.id),
  });
  const saved = rows.map((row): Reply => {
    const profile = authors.find((author) => author.userId === row.authorId);
    const name = profile?.displayName ?? row.authorName;
    const handle = profile?.handle ?? row.authorHandle;
    return {
      id: row.id,
      author: name,
      handle: handle ? `@${handle}` : "",
      avatarInitial: name[0]?.toUpperCase() ?? "?",
      content: row.content,
      timestamp: playedLabel(row.createdAt.getTime(), now),
      likes: 0,
      saved: true,
      mine: viewerId !== null && row.authorId === viewerId,
      edited: row.editedAt !== null,
    };
  });
  return [...saved, ...mock].map(withLikes);
}

// Newest saved replies per post a thread loads, and per profile Comments tab.
const REPLY_LIMIT = 100;
const PROFILE_COMMENT_LIMIT = 30;

/** A post's replies as `viewerId` sees them: saved ones newest first (none by anyone with a block either way), then the mock thread. */
export async function repliesFor(postId: string, viewerId: string | null): Promise<Reply[]> {
  const blocked = viewerId ? await blockedIdsFor(viewerId).catch(() => new Set<string>()) : new Set<string>();
  const rows = await getDb()
    .select()
    .from(postReplies)
    .where(and(eq(postReplies.postId, postId), isNull(postReplies.deletedAt), notBy(postReplies.authorId, blocked)))
    .orderBy(desc(postReplies.createdAt))
    .limit(REPLY_LIMIT);
  return toReplies(rows, POST_REPLIES[postId] ?? [], viewerId);
}

/** Whether `replyId` is a live reply under `postId`, saved or mock. */
export async function replyExists(postId: string, replyId: string): Promise<boolean> {
  if (POST_REPLIES[postId]?.some((reply) => reply.id === replyId)) return true;
  if (!isSavedPostId(replyId)) return false;
  const [row] = await getDb()
    .select({ id: postReplies.id })
    .from(postReplies)
    .where(and(eq(postReplies.id, replyId), eq(postReplies.postId, postId), isNull(postReplies.deletedAt)));
  return row !== undefined;
}

export async function setReplyLike(replyId: string, userId: string, liked: boolean): Promise<void> {
  const db = getDb();
  if (liked) await db.insert(replyLikes).values({ replyId, userId }).onConflictDoNothing();
  else await db.delete(replyLikes).where(and(eq(replyLikes.replyId, replyId), eq(replyLikes.userId, userId)));
}

/**
 * A real account's profile tabs: their saved omens (with engagement) and
 * their newest replies, each with the post it answers (replies to deleted
 * posts drop out). No trades yet. Empty if the DB can't be read.
 */
export async function accountActivity(authorId: string, viewerId: string | null): Promise<ProfileActivity> {
  try {
    const db = getDb();
    const [omens, rows] = await Promise.all([
      postsBy(authorId, viewerId).then((list) => withEngagement(list, viewerId)),
      db
        .select()
        .from(postReplies)
        .where(and(eq(postReplies.authorId, authorId), isNull(postReplies.deletedAt)))
        .orderBy(desc(postReplies.createdAt))
        .limit(PROFILE_COMMENT_LIMIT),
    ]);
    const [replies, savedParents] = await Promise.all([
      toReplies(rows, [], viewerId),
      savedPostsByIds([...new Set(rows.map((row) => row.postId))].filter((id) => !MOCK_POSTS.has(id)), viewerId),
    ]);
    const comments = rows.flatMap((row, index): ProfileComment[] => {
      const post = MOCK_POSTS.get(row.postId) ?? savedParents.find((candidate) => candidate.id === row.postId);
      return post ? [{ reply: replies[index], post }] : [];
    });
    return { omens, comments, trades: [] };
  } catch (error) {
    console.error("Profile activity unavailable", error);
    return { omens: [], comments: [], trades: [] };
  }
}
