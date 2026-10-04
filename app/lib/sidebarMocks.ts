// Mock content for the feed's persistent right rail (app/FeedSidebar.tsx).
// Same status as app/lib/mockPosts.ts: display-only, no backend, no
// computation — see docs/feeds.md.
import type { Market, Side } from "@/app/lib/mockPosts";
import type { RoomId } from "@/app/lib/rank";

// `tier` is the rank bracket the duel is played in ("Live in the Arena" shows its sigil).
export type LiveArena = { id: string; market: Market; players: string; timer: string; tier: RoomId };

export const LIVE_ARENAS: LiveArena[] = [
  { id: "d1", market: "btc", players: "Nova vs Ren", timer: "0:42", tier: "gold" },
  { id: "d2", market: "eth", players: "Zane vs 8bit Kay", timer: "1:15", tier: "oracle" },
  { id: "d3", market: "doge", players: "Marcus vs Priya", timer: "0:08", tier: "silver" },
];

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

export type CallWindow = "1h" | "24h" | "7d";

export type ProfitableCall = { id: string; handle: string; market: Market; side: Side; leverage: number; changePct: number };

// "Most Profitable Calls" (app/ProfitableCallsPanel.tsx) per time window.
// Deliberately not in rank order: the panel ranks by ROI (changePct ×
// leverage, flipped for shorts) and shows the top 3, so a big unleveraged
// move can lose to a small leveraged one.
export const PROFITABLE_CALLS: Record<CallWindow, ProfitableCall[]> = {
  "1h": [
    { id: "h1", handle: "@priya_p", market: "doge", side: "SHORT", leverage: 2, changePct: -2.6 },
    { id: "h2", handle: "@vesper", market: "btc", side: "SHORT", leverage: 20, changePct: -0.34 },
    { id: "h3", handle: "@juno_dx", market: "eth", side: "LONG", leverage: 15, changePct: 1.0 },
    { id: "h4", handle: "@nova_trades", market: "btc", side: "LONG", leverage: 10, changePct: 1.8 },
  ],
  "24h": [
    { id: "d1", handle: "@nova_trades", market: "btc", side: "LONG", leverage: 10, changePct: 1.8 },
    { id: "d2", handle: "@lena_q", market: "btc", side: "LONG", leverage: 5, changePct: 3.1 },
    { id: "d3", handle: "@zane_lfg", market: "btc", side: "LONG", leverage: 20, changePct: 1.4 },
    { id: "d4", handle: "@tobi.sol", market: "eth", side: "LONG", leverage: 25, changePct: 1.3 },
  ],
  "7d": [
    { id: "w1", handle: "@zane_lfg", market: "doge", side: "LONG", leverage: 5, changePct: 11.4 },
    { id: "w2", handle: "@lena_q", market: "eth", side: "LONG", leverage: 10, changePct: 7.2 },
    { id: "w3", handle: "@marcus_calls", market: "btc", side: "LONG", leverage: 20, changePct: 4.6 },
    { id: "w4", handle: "@vesper", market: "btc", side: "SHORT", leverage: 25, changePct: -2.9 },
  ],
};
