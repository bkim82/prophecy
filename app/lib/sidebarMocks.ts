// Mock content for the feed's persistent right rail (app/FeedSidebar.tsx).
// Same status as app/lib/mockPosts.ts: display-only, no backend, no
// computation — see docs/feeds.md.
import { GLOBAL_POSTS, type Market, type Post, type Side } from "@/app/lib/mockPosts";

export type LiveDuel = { id: string; market: Market; players: string; timer: string };

export const LIVE_DUELS: LiveDuel[] = [
  { id: "d1", market: "btc", players: "Nova vs Ren", timer: "0:42" },
  { id: "d2", market: "eth", players: "Zane vs 8bit Kay", timer: "1:15" },
  { id: "d3", market: "doge", players: "Marcus vs Priya", timer: "0:08" },
];

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
