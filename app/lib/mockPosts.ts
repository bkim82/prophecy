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
  // Community tag for the feed's market pills (app/FeedSwitcher.tsx). Only
  // needed on posts without a `call` — a call post's own `call.market`
  // already implies its community.
  market?: Market;
};

// Drives the "Following" feed filter (app/FeedSwitcher.tsx) — not a real
// social graph, just a hardcoded handle allowlist for the mock.
export const FOLLOWED_HANDLES = ["@nova_trades", "@ren.eth", "@zane_lfg"];

export type Reply = {
  id: string;
  author: string;
  handle: string;
  avatarInitial: string;
  content: string;
  timestamp: string;
  likes: number;
};

// Replies shown when a post's thread is expanded (app/PostCard.tsx's
// ReplyThread, toggled by the Reply action). Keyed by Post.id, a handful of
// loaded replies per post — independent of Post.replies (the decorative
// total count), same "not every reply is fetched" shorthand every real feed
// uses. Posts with no entry here render an empty-state instead.
export const POST_REPLIES: Record<string, Reply[]> = {
  g1: [
    { id: "g1-r1", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "LFG 🔥 called it", timestamp: "1m ago", likes: 4 },
    { id: "g1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "wish I sized up on this one", timestamp: "1m ago", likes: 2 },
    { id: "g1-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "6 for 6 this week, insane", timestamp: "45s ago", likes: 1 },
  ],
  g2: [
    { id: "g2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "hang in there, still time on the clock", timestamp: "3m ago", likes: 2 },
    { id: "g2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "25x on ETH rn is wild honestly", timestamp: "2m ago", likes: 1 },
  ],
  g3: [
    { id: "g3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "welcome to the club 🏆", timestamp: "8m ago", likes: 5 },
    { id: "g3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "gg! who'd you duel", timestamp: "7m ago", likes: 1 },
    { id: "g3-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "first of many", timestamp: "5m ago", likes: 3 },
  ],
  g7: [
    { id: "g7-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "dip buyers eating good fr", timestamp: "10m ago", likes: 9 },
    { id: "g7-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "reclaim looks clean on the chart", timestamp: "9m ago", likes: 4 },
    { id: "g7-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "loaded more at 66.8", timestamp: "6m ago", likes: 2 },
  ],
  g8: [
    { id: "g8-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "lmaooo felt this", timestamp: "16m ago", likes: 21 },
    { id: "g8-r2", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "doge gang stays coping", timestamp: "14m ago", likes: 33 },
    { id: "g8-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "this is a mood", timestamp: "9m ago", likes: 12 },
  ],
  g4: [{ id: "g4-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "so close, brutal", timestamp: "22m ago", likes: 1 }],
  g9: [
    { id: "g9-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "sizing down, thanks for the heads up", timestamp: "28m ago", likes: 6 },
    { id: "g9-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "violent move either way for sure", timestamp: "25m ago", likes: 3 },
  ],
  g5: [
    { id: "g5-r1", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "same, been checking every patch note", timestamp: "30m ago", likes: 3 },
    { id: "g5-r2", author: "DuelBot", handle: "@duelbot", avatarInitial: "D", content: "still cooking, no ETA yet", timestamp: "20m ago", likes: 8 },
  ],
  e1: [
    { id: "e1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "exclusive feed reads different fr", timestamp: "3m ago", likes: 6 },
    { id: "e1-r2", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "watching for the same pullback", timestamp: "2m ago", likes: 2 },
  ],
  e2: [
    { id: "e2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "volatility got you this time", timestamp: "14m ago", likes: 3 },
    { id: "e2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "high-rank lobby is no joke", timestamp: "11m ago", likes: 5 },
  ],
  e3: [
    { id: "e3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "congrats, queue's way faster up here", timestamp: "35m ago", likes: 4 },
    { id: "e3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "gg, see you in exclusive", timestamp: "30m ago", likes: 2 },
  ],
};

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
    market: "btc",
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
    market: "btc",
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
    market: "doge",
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
