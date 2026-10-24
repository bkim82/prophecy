// The feed's right rail (app/FeedSidebar.tsx): leaderboard, best trades and
// live rounds, all from real play — read by lib/sidebar.ts, only accounts
// with a handle, never house bots. Client-safe: no DB import. Each panel
// hides itself while it has nothing to show. See docs/feeds.md.
import type { TradeReceipt } from "@/app/lib/trades";
import type { RoomId } from "@/app/lib/rank";

export type LeaderboardPeriod = "24h" | "7d" | "all";
export type CallWindow = "1h" | "24h" | "7d";

const HOUR_MS = 3_600_000;
export const PERIOD_MS: Record<LeaderboardPeriod, number | null> = { "24h": 24 * HOUR_MS, "7d": 7 * 24 * HOUR_MS, all: null };
export const WINDOW_MS: Record<CallWindow, number> = { "1h": HOUR_MS, "24h": 24 * HOUR_MS, "7d": 7 * 24 * HOUR_MS };

// "Top Oracles" (app/OraclesLeaderboard.tsx): accounts ranked by net Embers
// from settled Arena rounds in the period. No score is shown; `winRate`
// (rounds won ÷ played, 0–1) only drives the avatar ring.
export type TopTrader = { handle: string; tier: string; winRate: number };

// "Most Profitable Calls" (app/ProfitableCallsPanel.tsx): closed trades that
// made money — 24h Portfolio positions and Arena rounds — best return first.
// `id` is unique per row.
export type ProfitableCall = Pick<TradeReceipt, "source" | "symbol" | "position" | "leverage" | "roiPct"> & { id: string; handle: string };

// "Live in the Arena" (app/LiveArenaPanel.tsx): Pulse rounds being played
// right now. `secondsLeft` is as of the page render; `tier` is the rank
// bracket of the higher-ranked player (its sigil).
export type LiveArena = { id: string; players: string; secondsLeft: number; tier: RoomId };

export type SidebarBoards = {
  leaders: Record<LeaderboardPeriod, TopTrader[]>;
  calls: Record<CallWindow, ProfitableCall[]>;
  arenas: LiveArena[];
};
