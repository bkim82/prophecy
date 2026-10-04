// Mock content for the feed's persistent right rail (app/FeedSidebar.tsx).
// Same status as app/lib/mockPosts.ts: display-only, no backend, no
// computation — see docs/feeds.md.
import { GLOBAL_POSTS, type Market, type Post, type Side } from "@/app/lib/mockPosts";

// "The Oracles" leaderboard (app/OraclesLeaderboard.tsx): top traders per
// period, already in rank order. No score is shown; winRate (0–1) only drives
// the avatar ring.
export type LeaderboardPeriod = "24h" | "7d" | "all";
export type TopTrader = { handle: string; tier: string; winRate: number };

const TRADERS = {
  vesper: { handle: "@vesper", tier: "Oracle I", winRate: 0.78 },
  nova: { handle: "@nova_trades", tier: "Oracle II", winRate: 0.74 },
  zane: { handle: "@zane_lfg", tier: "Oracle II", winRate: 0.71 },
  bitkay: { handle: "@8bitkay", tier: "Oracle III", winRate: 0.69 },
  tobi: { handle: "@tobi.sol", tier: "Oracle III", winRate: 0.66 },
  lena: { handle: "@lena_q", tier: "Oracle III", winRate: 0.64 },
  marcus: { handle: "@marcus_calls", tier: "Oracle III", winRate: 0.63 },
  kaito: { handle: "@kaito_sol", tier: "Oracle III", winRate: 0.61 },
  ren: { handle: "@ren.eth", tier: "Oracle III", winRate: 0.58 },
  priya: { handle: "@priya_p", tier: "Oracle III", winRate: 0.57 },
  juno: { handle: "@juno_dx", tier: "Oracle III", winRate: 0.55 },
} satisfies Record<string, TopTrader>;

const t = TRADERS;

export const TOP_TRADERS: Record<LeaderboardPeriod, TopTrader[]> = {
  "24h": [t.nova, t.kaito, t.vesper, t.marcus, t.zane, t.lena, t.bitkay, t.juno, t.tobi, t.ren],
  "7d": [t.vesper, t.zane, t.nova, t.tobi, t.bitkay, t.marcus, t.kaito, t.ren, t.lena, t.priya],
  all: [t.vesper, t.nova, t.ren, t.zane, t.lena, t.tobi, t.marcus, t.priya, t.kaito, t.bitkay],
};

export type TrendingCall = { id: string; handle: string; market: Market; side: Side; changePct: number };

export const TRENDING_CALLS: TrendingCall[] = [
  { id: "t1", handle: "@nova_trades", market: "btc", side: "LONG", changePct: 1.8 },
  { id: "t2", handle: "@zane_lfg", market: "btc", side: "LONG", changePct: 1.4 },
  { id: "t3", handle: "@ren.eth", market: "eth", side: "LONG", changePct: -0.4 },
];

// "Trending Prophecie" surfaces actual posts from the Global feed (by like
// count) rather than separate mock data — real tweets, not a synthetic
// leaderboard.
const TRENDING_PROPHECY_IDS = ["g8", "g7", "g1"];

export const TRENDING_PROPHECIES: Post[] = TRENDING_PROPHECY_IDS.map(
  (id) => GLOBAL_POSTS.find((post) => post.id === id)!,
);
