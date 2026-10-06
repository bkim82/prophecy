// Own-profile numbers (/profile, app/profile/page.tsx) with no backend yet —
// identical for every signed-in account. Identity, join date and match
// history are real (Clerk + the `matches` table); rank is VIEWER_RANK in
// app/lib/rank.ts; Following is FOLLOWED_HANDLES (app/lib/mockPosts.ts).
import type { ProfileRecords } from "@/app/lib/mockAchievements";
import type { TradingStyle } from "@/app/lib/profileTraits";

export const VIEWER_FOLLOWERS = 86;

// Nothing is actually copied yet — the feed's Copy button (app/PostCard.tsx)
// is unwired and there is no copy-trade ledger to sum.
export type CopyEarnings = {
  // Distinct traders who copied at least one of your trades.
  copiers: number;
  // Copied positions across all of them.
  copies: number;
  // USD paid out to you from copiers' trades.
  earned: number;
};

export const VIEWER_COPY_EARNINGS: CopyEarnings = { copiers: 37, copies: 112, earned: 1284.5 };

// The page swaps `duelsWon` for the real count from the Matches tab.
export const VIEWER_RECORDS: ProfileRecords = {
  peakElo: 1603,
  peakRank: "Gold III",
  bestTrade: { market: "btc", side: "LONG", leverage: 10, roi: 118, date: "Sep 2026" },
  longestStreak: 8,
  winRate: 0.57,
  calls: 146,
  bestSession: 19.4,
  duelsWon: 0,
};

// Archetype inputs (app/lib/profileTraits.ts archetypeFor). Mock because
// settled Pulse rounds don't keep leverage or side (lib/match.ts settleIfDue
// clears positions), so there's nothing real to measure yet. Reads as The Swift.
export const VIEWER_STYLE: TradingStyle = { pulseShare: 0.74, avgHoldHours: 1.5, fadeShare: 0.38, avgLeverage: 12 };
