import "server-only";

import { and, count, desc, eq, gt, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { directMessageMedia, directMessages, directThreads, profiles } from "@/db/schema";
import { folderFor, type ConversationView, type MessagePhoto, type MessageSummary, type MessageView, type Peer, type SharedPost, type ThreadView } from "@/app/lib/messageRules";
import type { Post } from "@/app/lib/posts";
import { blockStateBetween, blockedIdsFor } from "@/lib/blocks";
import { friendIdsAmong } from "@/lib/follows";
import type { PostPhotoInput } from "@/lib/postInput";
import { savedPostsByIds } from "@/lib/posts";
import { accountsFor, type ProfileMatch } from "@/lib/profile";
import { providerImagesFor } from "@/lib/viewer";

// Reads/writes for `direct_messages` / `direct_message_media` /
// `direct_threads` (db/schema.ts). Who may message whom lives in
// POST /api/messages/thread and app/messages/actions.ts; this layer only
// stores what it's handed. Times use the database clock. Only accounts with a
// handle are listed — the dock addresses everyone by @handle — and nobody
// with a block either way between you (lib/blocks.ts).

const CONVERSATION_LIMIT = 50;
const THREAD_LIMIT = 100;

// Your thread row for the other side of a message, joined per message.
const yourThread = (userId: string, peerId: string | SQL | PgColumn) =>
  and(eq(directThreads.userId, userId), eq(directThreads.peerId, peerId));
// Sent since you last deleted the conversation, and since you last read it.
const visible = sql`${directMessages.createdAt} > coalesce(${directThreads.clearedAt}, '-infinity')`;
const unreadSince = sql`${directMessages.createdAt} > coalesce(${directThreads.lastReadAt}, '-infinity')`;
const accepted = sql<boolean>`${directThreads.acceptedAt} is not null`;

const between = (a: string, b: string) =>
  or(
    and(eq(directMessages.senderId, a), eq(directMessages.recipientId, b)),
    and(eq(directMessages.senderId, b), eq(directMessages.recipientId, a)),
  );

type MessageRow = { id: string; body: string; senderId: string; postId: string | null; createdAt: Date };

const messageColumns = {
  id: directMessages.id,
  body: directMessages.body,
  senderId: directMessages.senderId,
  postId: directMessages.postId,
  createdAt: directMessages.createdAt,
};

const sharedPostView = (post: Post): SharedPost => {
  const photo = post.media?.[0];
  return {
    id: post.id,
    href: `/post/${encodeURIComponent(post.id)}`,
    author: post.author,
    handle: post.handle,
    avatarInitial: post.avatarInitial,
    content: post.content,
    rank: post.rank,
    imageUrl: photo?.kind === "photo" ? photo.src : undefined,
  };
};

/** Posts that can be shared into a conversation, by id: saved posts that still exist. */
export async function sharedPostsFor(ids: string[], viewerId: string): Promise<Map<string, SharedPost>> {
  const saved = await savedPostsByIds([...new Set(ids)], viewerId);
  return new Map(saved.map((post) => [post.id, sharedPostView(post)]));
}

// Rows → what the dock renders: photo URLs (never bytes) and shared posts resolved live.
async function messageViews(userId: string, rows: MessageRow[]): Promise<MessageView[]> {
  if (rows.length === 0) return [];
  const postIds = [...new Set(rows.flatMap((row) => (row.postId ? [row.postId] : [])))];
  const [media, posts] = await Promise.all([
    getDb()
      .select({ messageId: directMessageMedia.messageId, position: directMessageMedia.position, width: directMessageMedia.width, height: directMessageMedia.height })
      .from(directMessageMedia)
      .where(inArray(directMessageMedia.messageId, rows.map((row) => row.id)))
      .orderBy(directMessageMedia.position),
    postIds.length > 0 ? sharedPostsFor(postIds, userId) : new Map<string, SharedPost>(),
  ]);
  return rows.map((row) => {
    const photos: MessagePhoto[] = media
      .filter((item) => item.messageId === row.id)
      .map((item) => ({ src: `/api/messages/media/${row.id}/${item.position}`, width: item.width, height: item.height }));
    const view: MessageView = { id: row.id, body: row.body, mine: row.senderId === userId, sentAt: row.createdAt.getTime(), photos };
    if (row.postId) view.post = posts.get(row.postId) ?? null;
    return view;
  });
}

/** Accounts as the dock shows them, keyed by user id. Same photo precedence as their profile: app-owned upload, then provider photo. */
export async function peersFor(accounts: ProfileMatch[]): Promise<Map<string, Peer>> {
  const photos = await providerImagesFor(accounts.filter((account) => !account.hasAvatarImage).map((account) => account.userId));
  return new Map(
    accounts.map((account) => [
      account.userId,
      {
        handle: `@${account.handle}`,
        name: account.displayName ?? account.handle,
        imageUrl: account.hasAvatarImage
          ? `/api/profile/avatar?handle=${encodeURIComponent(account.handle)}&v=${account.updatedAt.getTime()}`
          : photos.get(account.userId),
      },
    ]),
  );
}

// Your unread messages grouped by sender, with whether you've accepted them.
async function unreadBySender(userId: string) {
  return getDb()
    .select({ senderId: directMessages.senderId, count: sql<number>`count(*)::int`, accepted: sql<boolean>`bool_or(${accepted})` })
    .from(directMessages)
    .innerJoin(profiles, and(eq(profiles.userId, directMessages.senderId), isNotNull(profiles.handle)))
    .leftJoin(directThreads, yourThread(userId, directMessages.senderId))
    .where(and(eq(directMessages.recipientId, userId), visible, unreadSince))
    .groupBy(directMessages.senderId);
}

/** Unread messages per folder and when your newest message was sent — every header heartbeat (POST /api/presence). */
export async function messageSummaryFor(userId: string): Promise<MessageSummary> {
  const [unread, [newest], blocked] = await Promise.all([
    unreadBySender(userId),
    getDb()
      .select({ at: sql<Date | null>`max(${directMessages.createdAt})`.mapWith(directMessages.createdAt) })
      .from(directMessages)
      .where(or(eq(directMessages.senderId, userId), eq(directMessages.recipientId, userId))),
    blockedIdsFor(userId),
  ]);
  const senders = unread.filter((row) => !blocked.has(row.senderId));
  const friends = await friendIdsAmong(userId, senders.map((row) => row.senderId));
  const summary: MessageSummary = { inbox: 0, requests: 0, latest: newest?.at?.getTime() ?? null };
  for (const row of senders) {
    if (folderFor(friends.has(row.senderId), row.accepted) === "inbox") summary.inbox += row.count;
    else summary.requests += row.count;
  }
  return summary;
}

/** Your conversations, newest first: each one's last message, unread count and folder. */
export async function conversationsFor(userId: string): Promise<ConversationView[]> {
  const db = getDb();
  const peerId = sql<string>`case when ${directMessages.senderId} = ${userId} then ${directMessages.recipientId} else ${directMessages.senderId} end`;
  // DISTINCT ON must repeat its ORDER BY expression exactly, so name the peer in a subquery first.
  const mine = db
    .select({ peerId: peerId.as("peer_id"), ...messageColumns, accepted: accepted.as("accepted") })
    .from(directMessages)
    .leftJoin(directThreads, yourThread(userId, peerId))
    .where(and(or(eq(directMessages.senderId, userId), eq(directMessages.recipientId, userId)), visible))
    .as("mine");
  const [lastRows, unread, blocked] = await Promise.all([
    db.selectDistinctOn([mine.peerId]).from(mine).orderBy(mine.peerId, desc(mine.createdAt), desc(mine.id)),
    unreadBySender(userId),
    blockedIdsFor(userId),
  ]);
  const newest = lastRows
    .filter((row) => !blocked.has(row.peerId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, CONVERSATION_LIMIT);
  const ids = newest.map((row) => row.peerId);
  const [accounts, friends, views] = await Promise.all([accountsFor(ids), friendIdsAmong(userId, ids), messageViews(userId, newest)]);
  const peers = await peersFor(accounts);
  const unreadFrom = new Map(unread.map((row) => [row.senderId, row.count]));
  return newest.flatMap((row, index) => {
    const peer = peers.get(row.peerId);
    if (!peer) return [];
    return [{ peer, last: views[index], unread: unreadFrom.get(row.peerId) ?? 0, folder: folderFor(friends.has(row.peerId), row.accepted) }];
  });
}

/** Your conversation with `peer`: the newest THREAD_LIMIT messages, oldest first — none while either of you has blocked the other. */
export async function threadWith(userId: string, peer: ProfileMatch): Promise<ThreadView> {
  const [rows, friends, peers, block] = await Promise.all([
    getDb()
      .select({ ...messageColumns, unread: sql<boolean>`${directMessages.senderId} = ${peer.userId} and ${unreadSince}`, accepted })
      .from(directMessages)
      .leftJoin(directThreads, yourThread(userId, peer.userId))
      .where(and(between(userId, peer.userId), visible))
      .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
      .limit(THREAD_LIMIT),
    friendIdsAmong(userId, [peer.userId]),
    peersFor([peer]),
    blockStateBetween(userId, peer.userId),
  ]);
  const blocked = block.youBlocked ? "by-you" : block.blockedYou ? "by-them" : null;
  const shown = blocked ? [] : rows;
  const unread = shown.filter((row) => row.unread);
  return {
    peer: peers.get(peer.userId)!,
    messages: await messageViews(userId, [...shown].reverse()),
    // Nothing from them yet is nothing to accept: it's yours to start.
    folder: shown.length === 0 ? "inbox" : folderFor(friends.has(peer.userId), shown[0].accepted),
    unread: unread.length,
    newestUnreadId: unread[0]?.id ?? null,
    blocked,
  };
}

const threadKey = [directThreads.userId, directThreads.peerId];

/** How many messages you've sent since `since` — POST /api/messages/thread's rate limit. */
export async function messageCountSince(senderId: string, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(directMessages)
    .where(and(eq(directMessages.senderId, senderId), gt(directMessages.createdAt, since)));
  return row?.n ?? 0;
}

export type NewMessage = { body: string; photos: PostPhotoInput[]; postId: string | null };

/** Saves a message (photos after it, in order) and accepts the conversation on your side — writing to someone takes them out of your Requests. */
export async function saveMessage(senderId: string, recipientId: string, message: NewMessage): Promise<MessageView> {
  const db = getDb();
  const id = crypto.randomUUID();
  const [[row]] = await Promise.all([
    db.insert(directMessages).values({ id, senderId, recipientId, body: message.body, postId: message.postId }).returning(messageColumns),
    acceptThread(senderId, recipientId),
  ]);
  if (message.photos.length > 0) {
    await db.insert(directMessageMedia).values(
      message.photos.map((photo, position) => ({ messageId: id, position, mime: photo.mime, image: photo.base64, width: photo.width, height: photo.height })),
    );
  }
  const [view] = await messageViews(senderId, [row]);
  return view;
}

/** One photo's bytes for GET /api/messages/media/[id]/[n] — only for the sender or recipient. */
export async function messageImage(viewerId: string, messageId: string, position: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await getDb()
    .select({ mime: directMessageMedia.mime, image: directMessageMedia.image })
    .from(directMessageMedia)
    .innerJoin(directMessages, eq(directMessages.id, directMessageMedia.messageId))
    .where(
      and(
        eq(directMessageMedia.messageId, messageId),
        eq(directMessageMedia.position, position),
        or(eq(directMessages.senderId, viewerId), eq(directMessages.recipientId, viewerId)),
      ),
    );
  return row ? { mime: row.mime, bytes: Buffer.from(row.image, "base64") } : null;
}

/** Marks their messages read up to `messageId` (one of theirs to you). Never moves backwards; an unknown id changes nothing. */
export async function markThreadRead(userId: string, peerId: string, messageId: string): Promise<void> {
  const readTo = sql`(select ${directMessages.createdAt} from ${directMessages} where ${directMessages.id} = ${messageId} and ${directMessages.senderId} = ${peerId} and ${directMessages.recipientId} = ${userId})`;
  await getDb()
    .insert(directThreads)
    .values({ userId, peerId, lastReadAt: readTo })
    .onConflictDoUpdate({ target: threadKey, set: { lastReadAt: sql`greatest(${directThreads.lastReadAt}, excluded.last_read_at)` } });
}

/** Moves a request to your inbox (Accept, or writing back). */
export async function acceptThread(userId: string, peerId: string): Promise<void> {
  await getDb()
    .insert(directThreads)
    .values({ userId, peerId, acceptedAt: sql`now()` })
    .onConflictDoUpdate({ target: threadKey, set: { acceptedAt: sql`coalesce(${directThreads.acceptedAt}, now())` } });
}

/** Deletes the conversation for you only: everything so far is gone, and a new message from them is a request again. */
export async function clearThread(userId: string, peerId: string): Promise<void> {
  const set = { clearedAt: sql`now()`, lastReadAt: sql`now()`, acceptedAt: null };
  await getDb().insert(directThreads).values({ userId, peerId, ...set }).onConflictDoUpdate({ target: threadKey, set });
}
