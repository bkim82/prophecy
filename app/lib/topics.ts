import type { Market, Post, PostKind } from "@/app/lib/mockPosts";

// Interest topics for the Omens feed (app/FeedSwitcher.tsx, app/FeedTopics.tsx).
// Currencies (the majors), coins (trending tokens), companies, people and
// general themes share one shape so a viewer can follow any mix of them. Posts
// are tagged by hand (Post.topics) plus the asset implied by their market —
// there's no classifier behind it.
export type TopicKind = "currency" | "coin" | "company" | "person" | "theme";

export type TopicId =
  | "bitcoin"
  | "ethereum"
  | "solana"
  | "dogecoin"
  | "pepe"
  | "bonk"
  | "wif"
  | "brett"
  | "hype"
  | "coinbase"
  | "blackrock"
  | "nvidia"
  | "saylor"
  | "vitalik"
  | "elon"
  | "memecoins"
  | "macro"
  | "ai"
  | "airdrops"
  | "defi";

// `glyph` is a currency symbol, a coin/company/person monogram or a theme
// mark — no brand logos. Coins go by $TICKER. `short` is the chip label when
// the full name is long.
export type Topic = { id: TopicId; label: string; short?: string; kind: TopicKind; glyph: string; color: string };

export const TOPICS: Topic[] = [
  { id: "bitcoin", label: "Bitcoin", kind: "currency", glyph: "₿", color: "#f7931a" },
  { id: "ethereum", label: "Ethereum", kind: "currency", glyph: "Ξ", color: "#7b8ff0" },
  { id: "solana", label: "Solana", kind: "currency", glyph: "◎", color: "#2fd6a3" },
  { id: "dogecoin", label: "$DOGE", kind: "coin", glyph: "Ð", color: "#c2a633" },
  { id: "pepe", label: "$PEPE", kind: "coin", glyph: "P", color: "#5fb83f" },
  { id: "bonk", label: "$BONK", kind: "coin", glyph: "B", color: "#f5a524" },
  { id: "wif", label: "$WIF", kind: "coin", glyph: "W", color: "#d2a77a" },
  { id: "brett", label: "$BRETT", kind: "coin", glyph: "B", color: "#5aa9ff" },
  { id: "hype", label: "$HYPE", kind: "coin", glyph: "H", color: "#7ce0c3" },
  { id: "coinbase", label: "Coinbase", kind: "company", glyph: "C", color: "#3d7bff" },
  { id: "blackrock", label: "BlackRock", kind: "company", glyph: "B", color: "#9a98ab" },
  { id: "nvidia", label: "Nvidia", kind: "company", glyph: "N", color: "#76b900" },
  { id: "saylor", label: "Michael Saylor", short: "Saylor", kind: "person", glyph: "MS", color: "#ff8a3d" },
  { id: "vitalik", label: "Vitalik Buterin", short: "Vitalik", kind: "person", glyph: "VB", color: "#9d86f5" },
  { id: "elon", label: "Elon Musk", short: "Elon", kind: "person", glyph: "EM", color: "#8fa3b8" },
  { id: "memecoins", label: "Memecoins", kind: "theme", glyph: "✺", color: "#e879b9" },
  { id: "macro", label: "Macro & the Fed", short: "Macro", kind: "theme", glyph: "%", color: "#e0b84f" },
  { id: "ai", label: "AI", kind: "theme", glyph: "◈", color: "#5ec8e5" },
  { id: "airdrops", label: "Airdrops", kind: "theme", glyph: "☂", color: "#b48cff" },
  { id: "defi", label: "DeFi", kind: "theme", glyph: "⇄", color: "#4fd1c5" },
];

export const TOPIC_KINDS: { kind: TopicKind; label: string; singular: string }[] = [
  { kind: "currency", label: "Currencies", singular: "Currency" },
  { kind: "coin", label: "Coins", singular: "Coin" },
  { kind: "company", label: "Companies", singular: "Company" },
  { kind: "person", label: "People", singular: "Person" },
  { kind: "theme", label: "Topics", singular: "Topic" },
];

// What a first-time viewer follows until they edit their interests: two
// currencies, two coins, a company, two people and a theme, already in
// kind-turn order (see coverOrder) so the chips match the covers.
export const DEFAULT_INTERESTS: TopicId[] = ["bitcoin", "pepe", "coinbase", "saylor", "macro", "ethereum", "bonk", "elon"];

const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));
export const topicById = (id: TopicId) => TOPIC_BY_ID.get(id)!;
export const isTopicId = (id: string): id is TopicId => TOPIC_BY_ID.has(id as TopicId);

const MARKET_TOPIC: Record<Market, TopicId> = { btc: "bitcoin", eth: "ethereum", sol: "solana", doge: "dogecoin" };

export function postTopics(post: Post): TopicId[] {
  const market = post.market ?? post.call?.market ?? post.clash?.market;
  const topics = post.topics ?? [];
  return market && !topics.includes(MARKET_TOPIC[market]) ? [MARKET_TOPIC[market], ...topics] : topics;
}

const matchesAny = (post: Post, interests: TopicId[]) => postTopics(post).some((id) => interests.includes(id));

// "2m ago" / "1h ago" / "45s ago" / "now" → minutes old.
export function ageMinutes(timestamp: string): number {
  const match = /^(\d+)\s*([smhd])/.exec(timestamp);
  if (!match) return 0;
  return Number(match[1]) * { s: 1 / 60, m: 1, h: 60, d: 1440 }[match[2] as "s" | "m" | "h" | "d"];
}

// Hacker-News-style hotness: log engagement minus age. Replies, vouches and
// defies count for more than likes; every 45 minutes costs a 10× engagement
// edge.
function postScore(post: Post): number {
  const engagement = post.likes + 2 * ((post.vouches ?? 0) + (post.defies ?? 0)) + 3 * post.replies;
  return Math.log10(1 + engagement) - ageMinutes(post.timestamp) / 45;
}

// Covers are ordinary posts, not banners or clashes.
const COVER_KINDS = new Set<PostKind>(["text", "call", "result"]);
const COVER_LIMIT = 8;

export type Cover = { post: Post; topic: Topic };

// Interests reordered to take turns by kind — a currency, a coin, a company, a
// person, a theme, then round again — with kinds in the order your interests
// first bring them up. Keeps three currencies from stacking at the top just
// because they were followed first.
function coverOrder(interests: TopicId[]): TopicId[] {
  const byKind = new Map<TopicKind, TopicId[]>();
  for (const id of interests) {
    const kind = topicById(id).kind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  const queues = [...byKind.values()];
  const out: TopicId[] = [];
  while (out.length < interests.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

// One cover per interest, in coverOrder: the hottest post tagged with it that
// an earlier cover hasn't claimed, preferring an author who doesn't have a
// cover yet. Interests with no post left are skipped.
export function pickCovers(posts: Post[], interests: TopicId[]): Cover[] {
  const usedPosts = new Set<string>();
  const usedAuthors = new Set<string>();
  const covers: Cover[] = [];
  for (const id of coverOrder(interests)) {
    if (covers.length === COVER_LIMIT) break;
    const candidates = posts.filter((post) => COVER_KINDS.has(post.kind) && !usedPosts.has(post.id) && postTopics(post).includes(id));
    const fresh = candidates.filter((post) => !usedAuthors.has(post.handle));
    let best: Post | undefined;
    for (const post of fresh.length > 0 ? fresh : candidates) {
      if (!best || postScore(post) > postScore(best)) best = post;
    }
    if (!best) continue;
    usedPosts.add(best.id);
    usedAuthors.add(best.handle);
    covers.push({ post: best, topic: topicById(id) });
  }
  return covers;
}

// The feed under the covers: posts from your topics keep their order, with
// one post from outside them after every three so the feed doesn't seal shut.
const DISCOVERY_EVERY = 3;

export function personalize(posts: Post[], interests: TopicId[]): Post[] {
  if (interests.length === 0) return posts;
  const yours: Post[] = [];
  const other: Post[] = [];
  for (const post of posts) (matchesAny(post, interests) ? yours : other).push(post);
  const out: Post[] = [];
  while (yours.length > 0 || other.length > 0) out.push(...yours.splice(0, DISCOVERY_EVERY), ...other.splice(0, 1));
  return out;
}

// "Mix it up": round-robin across your topics (in coverOrder) — one post from
// each in turn — so no single topic dominates. Posts outside your topics are
// left out.
export function blendTopics(posts: Post[], interests: TopicId[]): Post[] {
  const queues = coverOrder(interests).map((id) => posts.filter((post) => postTopics(post).includes(id)));
  const used = new Set<string>();
  const out: Post[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      while (queue.length > 0 && used.has(queue[0].id)) queue.shift();
      const next = queue.shift();
      if (!next) continue;
      used.add(next.id);
      out.push(next);
    }
  }
  return out;
}
