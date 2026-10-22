import { isTopicId, type TopicId } from "@/app/lib/topics";

// Inferred interests: topics the account never followed but keeps engaging
// with. Every signal (lib/topicPrefs.ts reads them from `topic_signals` plus
// the account's own posts) credits each topic on its post, weighted by how
// deliberate the action is and halved every HALF_LIFE_DAYS. A topic counts
// once its score reaches INFER_AT from at least MIN_SOURCES different posts
// or visits — about 3 likes or 2 bookmarks in the last few days, 5 topic
// visits, or a mix (2 likes is not enough) — so one heavily-engaged post
// can't make an interest on its own. Pure, so the server computes it and the
// tests pin it (lib/topicInterest.test.ts).

export const SIGNAL_WEIGHTS = {
  view_topic: 1, // opened a topic's feed (chip, "See more", topic tag)
  open_post: 1, // opened a post's page
  like: 2,
  repost: 3, // repost, vouch or defy
  reply: 3,
  bookmark: 3,
  post: 4, // wrote a post tagged with it (server-side, from `posts`)
} as const;

export type TopicSignal = keyof typeof SIGNAL_WEIGHTS;
// What the browser may report (POST /api/topics/signal); `post` comes from the posts table.
export type ClientTopicSignal = Exclude<TopicSignal, "post">;

export const isTopicSignal = (value: string): value is TopicSignal => Object.hasOwn(SIGNAL_WEIGHTS, value);
export const isClientTopicSignal = (value: string): value is ClientTopicSignal => isTopicSignal(value) && value !== "post";

export const HALF_LIFE_DAYS = 14;
// Older signals are ignored (and not read).
export const WINDOW_DAYS = 60;
export const INFER_AT = 5;
export const MIN_SOURCES = 2;
// Followed topics stay the bulk of For You's covers.
export const MAX_INFERRED = 4;
// Reopening the same topic within this window counts as one visit.
export const VIEW_DEDUPE_MINUTES = 15;

const DAY_MS = 86_400_000;

// `postId` is the post the signal was on ("" for a topic visit); `at` is ms.
export type SignalEvent = { topic: string; signal: TopicSignal; postId: string; at: number };

// What an account's For You runs on (lib/topicPrefs.ts accountTopics):
// followed and Not interested topics as saved, plus what its activity infers.
export type AccountTopics = { followed: TopicId[]; muted: TopicId[]; inferred: TopicId[] };

type Tally = { score: number; sources: Set<string>; last: number };

export function topicScores(events: SignalEvent[], now: number): Map<TopicId, Tally> {
  const tallies = new Map<TopicId, Tally>();
  for (const event of events) {
    const ageDays = Math.max(0, now - event.at) / DAY_MS;
    if (!isTopicId(event.topic) || ageDays > WINDOW_DAYS) continue;
    const tally = tallies.get(event.topic) ?? { score: 0, sources: new Set<string>(), last: 0 };
    tally.score += SIGNAL_WEIGHTS[event.signal] * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    tally.sources.add(event.postId || `visit:${event.at}`);
    tally.last = Math.max(tally.last, event.at);
    tallies.set(event.topic, tally);
  }
  return tallies;
}

// Strongest first (ties: most recent), never a followed or Not interested topic.
export function inferInterests(events: SignalEvent[], { followed, muted, now }: { followed: TopicId[]; muted: TopicId[]; now: number }): TopicId[] {
  return [...topicScores(events, now)]
    .filter(([id, tally]) => tally.score >= INFER_AT && tally.sources.size >= MIN_SOURCES && !followed.includes(id) && !muted.includes(id))
    .sort(([, a], [, b]) => b.score - a.score || b.last - a.last)
    .slice(0, MAX_INFERRED)
    .map(([id]) => id);
}
