// Mock feed content for the Global/Exclusive Twitter-style pages. No backend,
// no persistence, no posting flow yet — see docs/feeds.md.
//
// Author/handle here are plain hardcoded strings. Real posts should use Clerk
// identity (currentUser()/useUser()) for authorship — Clerk gives a
// persistent, visible name/handle, unlike the anonymous per-browser id from
// app/lib/playerId.ts, which is only meant for anonymous matchmaking.
// Trade-off for a future posting pass: signed-out visitors could view feeds
// but would need to sign in to post.
export type Market = "btc" | "eth" | "doge";
export type Side = "LONG" | "SHORT";
export type OutcomeStatus = "won" | "lost" | "close";

// "won"/"lost" carry a dollar PnL (leveraged Pulse-style position). "close"
// carries a plain-language miss distance instead (Quick Play predicts an
// exact settlement price, so a near-miss isn't a dollar amount).
export type Outcome = {
  status: OutcomeStatus;
  amount?: number;
  diff?: string;
};

export type MarketCall = {
  market: Market;
  side: Side;
  leverage?: number;
  entryPrice: string;
  currentPrice: string;
  changePct: number;
  spark: number[];
  outcome?: Outcome;
  // Only meaningful while `outcome` is unset — a resolved call has nothing
  // left to count down. Static display string, not a live countdown.
  expiresIn?: string;
};

// Placeholder art standing in for real image uploads (no asset pipeline
// yet) — "chart" draws a big sparkline from `spark`, "meme" is a gradient
// tile (keyed off `seed`, same trick as the avatar gradient) with a large
// emoji. Purely decorative, no real chart/photo data behind either.
export type PostImage =
  | { kind: "chart"; seed: string; spark: number[] }
  | { kind: "meme"; seed: string; emoji: string };

// Every post renders through PostCard, which branches on `kind`:
// "text" = plain take, "call"/"result" = market-call hero (pending vs
// resolved), "streak" = compact highlight banner, "promo" = quiet system
// line with no avatar/actions.
export type PostKind = "text" | "call" | "result" | "streak" | "promo";

export type Post = {
  id: string;
  author: string;
  handle: string;
  avatarInitial: string;
  content: string;
  timestamp: string;
  likes: number;
  replies: number;
  kind: PostKind;
  rank?: string;
  call?: MarketCall;
  image?: PostImage;
  streakStat?: string;
};

export const LIVE_PLAYER_COUNT = 2486;
export const LIVE_DUEL_COUNT = 384;

// Drives the "Following" feed filter (app/FeedSwitcher.tsx) — not a real
// social graph, just a hardcoded handle allowlist for the mock.
export const FOLLOWED_HANDLES = ["@nova_trades", "@ren.eth", "@zane_lfg"];

export const GLOBAL_POSTS: Post[] = [
  {
    id: "g1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "Called BTC up 3 rounds in a row. Cast is printing today.",
    timestamp: "2m ago",
    likes: 41,
    replies: 6,
    kind: "result",
    rank: "Gold II",
    call: {
      market: "btc",
      side: "LONG",
      leverage: 10,
      entryPrice: "67,240",
      currentPrice: "68,451",
      changePct: 1.8,
      spark: [66.8, 67.0, 67.4, 67.1, 67.6, 67.9, 68.1, 68.45],
      outcome: { status: "won", amount: 4200 },
    },
  },
  {
    id: "g2",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "Pulse leverage on ETH is nasty right now. Down 0.4 and I'm sweating.",
    timestamp: "6m ago",
    likes: 18,
    replies: 3,
    kind: "call",
    rank: "Silver I",
    call: {
      market: "eth",
      side: "LONG",
      leverage: 25,
      entryPrice: "3,428",
      currentPrice: "3,412",
      changePct: -0.4,
      spark: [3440, 3435, 3430, 3422, 3418, 3415, 3413, 3412],
      expiresIn: "3h 40m",
    },
  },
  {
    id: "g-streak1",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "Called BTC's close again before the 11:59pm bell. Streak's still alive.",
    timestamp: "9m ago",
    likes: 76,
    replies: 9,
    kind: "streak",
    rank: "Gold I",
    streakStat: "6-day streak",
  },
  {
    id: "g3",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "New to Prophecy, just won my first head-to-head. This is way more fun than I expected.",
    timestamp: "11m ago",
    likes: 63,
    replies: 12,
    kind: "text",
    rank: "Bronze III",
  },
  {
    id: "g7",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "BTC reclaiming 68k like it's nothing. Dip buyers eating good this week.",
    timestamp: "14m ago",
    likes: 134,
    replies: 22,
    kind: "text",
    rank: "Gold I",
    image: { kind: "chart", seed: "btc-reclaim", spark: [65.1, 65.6, 65.3, 66.2, 67.0, 66.8, 67.6, 68.4] },
  },
  {
    id: "g8",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "me explaining to my portfolio why I'm still long doge",
    timestamp: "19m ago",
    likes: 302,
    replies: 41,
    kind: "text",
    rank: "Silver II",
    image: { kind: "meme", seed: "doge-cope", emoji: "🐕" },
  },
  {
    id: "g4",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "DOGE daily coin round was chaos. GG to whoever took the other side of that.",
    timestamp: "24m ago",
    likes: 9,
    replies: 1,
    kind: "result",
    rank: "Gold I",
    call: {
      market: "doge",
      side: "SHORT",
      entryPrice: "0.1682",
      currentPrice: "0.1638",
      changePct: -2.6,
      spark: [0.171, 0.170, 0.169, 0.168, 0.1675, 0.167, 0.1645, 0.1638],
      outcome: { status: "close", diff: "$38 off target" },
    },
  },
  {
    id: "g9",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "FOMC minutes drop in an hour. Options desks are pricing in a violent move either direction — size down.",
    timestamp: "33m ago",
    likes: 58,
    replies: 15,
    kind: "text",
    rank: "Silver I",
  },
  {
    id: "g5",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "Anyone else notice the 24h Reading mode is still \"soon\"? Been waiting on this one.",
    timestamp: "38m ago",
    likes: 27,
    replies: 8,
    kind: "text",
    rank: "Silver II",
  },
  {
    id: "g6",
    author: "OracleBot",
    handle: "@oraclebot",
    avatarInitial: "O",
    content: "New: resolved calls now show WON, LOST, or how close you got — right in the feed.",
    timestamp: "1h ago",
    likes: 5,
    replies: 0,
    kind: "promo",
  },
];

export const EXCLUSIVE_POSTS: Post[] = [
  {
    id: "e1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "Exclusive alpha: watching for a BTC pullback before the next Pulse round. Not financial advice, obviously.",
    timestamp: "4m ago",
    likes: 112,
    replies: 21,
    kind: "call",
    rank: "Gold II",
    call: {
      market: "btc",
      side: "LONG",
      leverage: 10,
      entryPrice: "67,240",
      currentPrice: "68,451",
      changePct: 1.8,
      spark: [66.8, 67.0, 67.4, 67.1, 67.6, 67.9, 68.1, 68.45],
      expiresIn: "5h 10m",
    },
  },
  {
    id: "e2",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "High-rank lobby only — the read on ETH volatility here is completely different from the public feed.",
    timestamp: "17m ago",
    likes: 84,
    replies: 14,
    kind: "result",
    rank: "Silver I",
    call: {
      market: "eth",
      side: "SHORT",
      leverage: 15,
      entryPrice: "3,398",
      currentPrice: "3,431",
      changePct: 0.97,
      spark: [3398, 3402, 3405, 3411, 3418, 3422, 3427, 3431],
      outcome: { status: "lost", amount: 1200 },
    },
  },
  {
    id: "e3",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "Ranked up to Gold this week. The exclusive queue moves so much faster.",
    timestamp: "42m ago",
    likes: 56,
    replies: 9,
    kind: "text",
    rank: "Gold III",
  },
];
