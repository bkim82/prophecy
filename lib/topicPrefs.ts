import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { onboarding, posts, topicPrefs, topicSignals } from "@/db/schema";
import { EXCLUSIVE_POSTS, GLOBAL_POSTS } from "@/app/lib/mockPosts";
import {
  VIEW_DEDUPE_MINUTES,
  WINDOW_DAYS,
  inferInterests,
  isTopicSignal,
  type AccountTopics,
  type ClientTopicSignal,
  type SignalEvent,
} from "@/app/lib/topicInterest";
import { DEFAULT_INTERESTS, isTopicId, postTopics, type TopicId } from "@/app/lib/topics";

// Reads/writes for `topic_prefs` and `topic_signals` (db/schema.ts): an
// account's followed / Not interested topics and the engagement that infers
// more (app/lib/topicInterest.ts). Validation of browser input lives in
// app/topicActions.ts and app/api/topics/signal/route.ts.

const MAX_SIGNAL_ROWS = 2000;

/** The For You topics for app/page.tsx and /compose. */
export async function accountTopics(userId: string, now = Date.now()): Promise<AccountTopics> {
  const db = getDb();
  const since = new Date(now - WINDOW_DAYS * 86_400_000);
  const [[prefs], [answers], signals, authored] = await Promise.all([
    db.select({ followed: topicPrefs.followed, muted: topicPrefs.muted }).from(topicPrefs).where(eq(topicPrefs.userId, userId)),
    db.select({ interests: onboarding.interests }).from(onboarding).where(eq(onboarding.userId, userId)),
    db
      .select({ topic: topicSignals.topic, signal: topicSignals.signal, postId: topicSignals.postId, at: topicSignals.createdAt })
      .from(topicSignals)
      .where(and(eq(topicSignals.userId, userId), gt(topicSignals.createdAt, since)))
      .orderBy(desc(topicSignals.createdAt))
      .limit(MAX_SIGNAL_ROWS),
    db
      .select({ id: posts.id, topics: posts.topics, at: posts.createdAt })
      .from(posts)
      .where(and(eq(posts.authorId, userId), isNull(posts.deletedAt), gt(posts.createdAt, since))),
  ]);
  // No saved row: what they picked at /welcome (possibly nothing), else the
  // defaults for accounts from before onboarding.
  const followed = (prefs?.followed ?? answers?.interests ?? DEFAULT_INTERESTS).filter(isTopicId);
  const muted = (prefs?.muted ?? []).filter(isTopicId);
  const events: SignalEvent[] = [
    ...signals.flatMap((row) => (isTopicSignal(row.signal) ? [{ topic: row.topic, signal: row.signal, postId: row.postId, at: row.at.getTime() }] : [])),
    ...authored.flatMap((post) => post.topics.map((topic) => ({ topic, signal: "post" as const, postId: post.id, at: post.at.getTime() }))),
  ];
  return { followed, muted, inferred: inferInterests(events, { followed, muted, now }) };
}

/**
 * Replaces both lists. Unfollowing a topic (not muting it — Undo restores a
 * mute) also clears its signals, so it isn't straight back as an inferred
 * interest. Only a saved row counts as a previous follow list.
 */
export async function saveTopicPrefs(userId: string, followed: TopicId[], muted: TopicId[]): Promise<void> {
  const db = getDb();
  const [previous] = await db.select({ followed: topicPrefs.followed }).from(topicPrefs).where(eq(topicPrefs.userId, userId));
  const set = { followed, muted, updatedAt: new Date() };
  await db.insert(topicPrefs).values({ userId, ...set }).onConflictDoUpdate({ target: topicPrefs.userId, set });
  const dropped = (previous?.followed ?? []).filter((id) => !followed.includes(id as TopicId) && !muted.includes(id as TopicId));
  if (dropped.length > 0) await db.delete(topicSignals).where(and(eq(topicSignals.userId, userId), inArray(topicSignals.topic, dropped)));
}

/**
 * The topics a signal on `postId` credits: a mock post's (postTopics), or a
 * saved post's own tags. Null for unknown/deleted posts; [] for your own saved
 * posts, which already count through `posts`.
 */
export async function signalTopicsFor(postId: string, userId: string): Promise<TopicId[] | null> {
  const mock = [...GLOBAL_POSTS, ...EXCLUSIVE_POSTS].find((post) => post.id === postId);
  if (mock) return postTopics(mock);
  if (!/^[0-9a-f-]{36}$/.test(postId)) return null;
  const [row] = await getDb()
    .select({ authorId: posts.authorId, topics: posts.topics })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  if (!row) return null;
  return row.authorId === userId ? [] : row.topics.filter(isTopicId);
}

export async function signalCountSince(userId: string, since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(topicSignals)
    .where(and(eq(topicSignals.userId, userId), gt(topicSignals.createdAt, since)));
  return row?.n ?? 0;
}

/**
 * `on` records the signal (once per post; a topic visit at most once per
 * VIEW_DEDUPE_MINUTES), `!on` takes a post signal back (unlike, unbookmark,
 * undo repost). `postId` is "" for topic visits.
 */
export async function recordTopicSignal(userId: string, signal: ClientTopicSignal, topics: TopicId[], postId: string, on: boolean): Promise<void> {
  const db = getDb();
  if (!on) {
    if (postId) await db.delete(topicSignals).where(and(eq(topicSignals.userId, userId), eq(topicSignals.signal, signal), eq(topicSignals.postId, postId)));
    return;
  }
  if (topics.length === 0) return;
  if (!postId) {
    const since = new Date(Date.now() - VIEW_DEDUPE_MINUTES * 60_000);
    const [recent] = await db
      .select({ topic: topicSignals.topic })
      .from(topicSignals)
      .where(and(eq(topicSignals.userId, userId), eq(topicSignals.signal, signal), eq(topicSignals.postId, ""), inArray(topicSignals.topic, topics), gt(topicSignals.createdAt, since)))
      .limit(1);
    if (recent) return;
  }
  await db
    .insert(topicSignals)
    .values(topics.map((topic) => ({ userId, topic, signal, postId })))
    .onConflictDoNothing();
}
