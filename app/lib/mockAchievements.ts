// Mock all-time records for the achievements rail on /profile/[handle]
// (app/profile/[handle]/ProfileAchievements.tsx). Hand-picked per handle —
// no Elo system exists yet (app/lib/rank.ts is a stub), and the feed mocks
// only hold a couple of recent trades per author, so these are career
// numbers rather than anything derived from profileActivity().
// Keep `peakRank` at or above the profile's current rank, and each
// trader's first PINNED_OMENS entry equal to their `bestTrade`.
import type { Market, Side } from "@/app/lib/mockPosts";
import type { AssetAccuracy, Highlight, TradingStyle } from "@/app/lib/profileTraits";

export type BestTrade = { market: Market; side: Side; leverage: number; roi: number; date: string };

export type ProfileRecords = {
  peakElo: number;
  peakRank: string;
  bestTrade: BestTrade;
  // Most fulfilled calls in a row.
  longestStreak: number;
  // Fraction of settled calls fulfilled.
  winRate: number;
  calls: number;
  // Best 24h Portfolio session, % P&L.
  bestSession: number;
  duelsWon: number;
};

export const RECORDS: Record<string, ProfileRecords> = {
  "@vesper": { peakElo: 2486, peakRank: "Oracle", bestTrade: { market: "btc", side: "SHORT", leverage: 25, roi: 284, date: "Aug 2026" }, longestStreak: 17, winRate: 0.71, calls: 1284, bestSession: 46.2, duelsWon: 412 },
  "@juno_dx": { peakElo: 1912, peakRank: "Diamond III", bestTrade: { market: "eth", side: "LONG", leverage: 15, roi: 196, date: "Jun 2026" }, longestStreak: 12, winRate: 0.66, calls: 640, bestSession: 31.5, duelsWon: 188 },
  "@nova_trades": { peakElo: 1642, peakRank: "Gold III", bestTrade: { market: "btc", side: "LONG", leverage: 10, roi: 142, date: "Sep 2026" }, longestStreak: 11, winRate: 0.62, calls: 905, bestSession: 27.8, duelsWon: 236 },
  "@zane_lfg": { peakElo: 1571, peakRank: "Gold II", bestTrade: { market: "btc", side: "LONG", leverage: 5, roi: 61, date: "Jul 2026" }, longestStreak: 14, winRate: 0.58, calls: 312, bestSession: 12.4, duelsWon: 74 },
  "@marcus_calls": { peakElo: 1488, peakRank: "Gold I", bestTrade: { market: "doge", side: "LONG", leverage: 3, roi: 88, date: "Mar 2026" }, longestStreak: 6, winRate: 0.54, calls: 428, bestSession: 18.9, duelsWon: 61 },
  "@ren.eth": { peakElo: 1431, peakRank: "Gold I", bestTrade: { market: "eth", side: "LONG", leverage: 25, roi: 210, date: "May 2026" }, longestStreak: 5, winRate: 0.49, calls: 210, bestSession: 22.0, duelsWon: 33 },
  "@priya_p": { peakElo: 1352, peakRank: "Silver III", bestTrade: { market: "doge", side: "LONG", leverage: 5, roi: 132, date: "Aug 2026" }, longestStreak: 7, winRate: 0.55, calls: 176, bestSession: 38.7, duelsWon: 28 },
  "@lena_q": { peakElo: 1384, peakRank: "Silver III", bestTrade: { market: "btc", side: "LONG", leverage: 2, roi: 24, date: "Sep 2026" }, longestStreak: 4, winRate: 0.52, calls: 98, bestSession: 6.1, duelsWon: 12 },
  "@8bitkay": { peakElo: 1142, peakRank: "Silver I", bestTrade: { market: "eth", side: "LONG", leverage: 40, roi: 164, date: "Sep 2026" }, longestStreak: 3, winRate: 0.44, calls: 64, bestSession: 9.3, duelsWon: 9 },
  "@tobi.sol": { peakElo: 1036, peakRank: "Bronze III", bestTrade: { market: "eth", side: "LONG", leverage: 50, roi: 95, date: "Sep 2026" }, longestStreak: 2, winRate: 0.41, calls: 41, bestSession: 4.2, duelsWon: 5 },
};

// Per-asset accuracy behind the hero's "BTC 78% · SOL 61% · ETH 40%" line and
// signature asset (most calls). Roughly averages to each RECORDS winRate.
export const ACCURACY: Record<string, AssetAccuracy[]> = {
  "@vesper": [{ asset: "BTC", accuracy: 0.78, calls: 640 }, { asset: "ETH", accuracy: 0.66, calls: 410 }, { asset: "SOL", accuracy: 0.61, calls: 234 }],
  "@juno_dx": [{ asset: "ETH", accuracy: 0.72, calls: 380 }, { asset: "BTC", accuracy: 0.61, calls: 190 }, { asset: "SOL", accuracy: 0.55, calls: 70 }],
  "@nova_trades": [{ asset: "BTC", accuracy: 0.66, calls: 720 }, { asset: "ETH", accuracy: 0.47, calls: 185 }],
  "@zane_lfg": [{ asset: "BTC", accuracy: 0.61, calls: 290 }, { asset: "ETH", accuracy: 0.32, calls: 22 }],
  "@marcus_calls": [{ asset: "DOGE", accuracy: 0.58, calls: 260 }, { asset: "BTC", accuracy: 0.52, calls: 120 }, { asset: "ETH", accuracy: 0.42, calls: 48 }],
  "@ren.eth": [{ asset: "ETH", accuracy: 0.51, calls: 170 }, { asset: "BTC", accuracy: 0.38, calls: 40 }],
  "@priya_p": [{ asset: "DOGE", accuracy: 0.61, calls: 120 }, { asset: "SOL", accuracy: 0.47, calls: 36 }, { asset: "BTC", accuracy: 0.4, calls: 20 }],
  "@lena_q": [{ asset: "BTC", accuracy: 0.55, calls: 70 }, { asset: "ETH", accuracy: 0.46, calls: 28 }],
  "@8bitkay": [{ asset: "ETH", accuracy: 0.47, calls: 38 }, { asset: "DOGE", accuracy: 0.44, calls: 16 }, { asset: "BTC", accuracy: 0.3, calls: 10 }],
  "@tobi.sol": [{ asset: "SOL", accuracy: 0.52, calls: 21 }, { asset: "ETH", accuracy: 0.31, calls: 16 }, { asset: "BTC", accuracy: 0.43, calls: 4 }],
};

// Inputs to archetypeFor() (app/lib/profileTraits.ts), picked to fit each
// persona: Vesper/Lena fade, Juno/Marcus/Priya hold, Nova/Zane scalp Pulse,
// Ren/Kay/Tobi live at 20×+.
export const STYLES: Record<string, TradingStyle> = {
  "@vesper": { pulseShare: 0.18, avgHoldHours: 9, fadeShare: 0.68, avgLeverage: 14 },
  "@juno_dx": { pulseShare: 0.08, avgHoldHours: 72, fadeShare: 0.3, avgLeverage: 6 },
  "@nova_trades": { pulseShare: 0.82, avgHoldHours: 0.4, fadeShare: 0.34, avgLeverage: 10 },
  "@zane_lfg": { pulseShare: 0.64, avgHoldHours: 6, fadeShare: 0.22, avgLeverage: 5 },
  "@marcus_calls": { pulseShare: 0.2, avgHoldHours: 60, fadeShare: 0.41, avgLeverage: 3 },
  "@ren.eth": { pulseShare: 0.45, avgHoldHours: 5, fadeShare: 0.28, avgLeverage: 22 },
  "@priya_p": { pulseShare: 0.15, avgHoldHours: 96, fadeShare: 0.12, avgLeverage: 4 },
  "@lena_q": { pulseShare: 0.25, avgHoldHours: 20, fadeShare: 0.62, avgLeverage: 3 },
  "@8bitkay": { pulseShare: 0.3, avgHoldHours: 14, fadeShare: 0.2, avgLeverage: 31 },
  "@tobi.sol": { pulseShare: 0.55, avgHoldHours: 2, fadeShare: 0.18, avgLeverage: 38 },
};

// Highlight reel: each trader's pinned fulfilled omens (≤ MAX_PINS), best
// first — older calls than the live feed, so not in mockPosts.ts.
const omen = (id: string, asset: string, side: "LONG" | "SHORT", leverage: number, roi: number, date: string, text: string): Highlight => ({ kind: "omen", id, asset, side, leverage, roi, date, text });

export const PINNED_OMENS: Record<string, Highlight[]> = {
  "@vesper": [
    omen("v-pin1", "BTC", "SHORT", 25, 284, "Aug 2026", "Funding's at the highest since the top and the 72k wall keeps refilling. Fading it — stop above 72.6k."),
    omen("v-pin2", "ETH", "SHORT", 15, 156, "Jun 2026", "ETH/BTC breaking down while the timeline posts ETH targets. Shorting the crowd's favorite child."),
    omen("v-pin3", "BTC", "SHORT", 20, 122, "Mar 2026", "Open interest doubled into the weekend. Somebody's getting squeezed and it isn't me."),
  ],
  "@juno_dx": [
    omen("j-pin1", "ETH", "LONG", 15, 196, "Jun 2026", "Real spot bid under ETH three days straight. Not flows — buyers. Long to 4k."),
    omen("j-pin2", "BTC", "LONG", 5, 64, "Apr 2026", "Basis compressing while spot volume climbs. That's accumulation. Long, invalidation at the weekly open."),
    omen("j-pin3", "SOL", "LONG", 8, 58, "Feb 2026", "SOL spot volume finally showing up on the dips. Taking the long."),
  ],
  "@nova_trades": [
    omen("n-pin1", "BTC", "LONG", 10, 142, "Sep 2026", "BTC reclaiming the round open on the 1m. Long into the next Pulse print."),
    omen("n-pin2", "BTC", "LONG", 10, 96, "Aug 2026", "Three green Pulse rounds, same setup. Going again."),
  ],
  "@zane_lfg": [
    omen("z-pin1", "BTC", "LONG", 5, 61, "Jul 2026", "BTC closes above 64k tonight. Day 9 of the streak, calling it before the bell."),
    omen("z-pin2", "BTC", "LONG", 3, 34, "Jun 2026", "Daily close call: green. Streak's alive."),
  ],
  "@marcus_calls": [
    omen("m-pin1", "DOGE", "LONG", 3, 88, "Mar 2026", "DOGE bled for a month and nobody talks about it anymore. That's the bottom. Loading."),
    omen("m-pin2", "BTC", "LONG", 2, 41, "Jan 2026", "BTC wicked into the 60k bids and got eaten instantly. Dip buyers are back."),
    omen("m-pin3", "ETH", "LONG", 3, 37, "Nov 2025", "Bridge-exploit dump on ETH is an overreaction. Buying the fear."),
  ],
  "@ren.eth": [omen("r-pin1", "ETH", "LONG", 25, 210, "May 2026", "ETH 25x long. Yes, again. The chart actually looks ready this time.")],
  "@priya_p": [
    omen("p-pin1", "DOGE", "LONG", 5, 132, "Aug 2026", "The dog coin listing rumor is real, I can feel it. Long doge, see you on the other side."),
    omen("p-pin2", "SOL", "LONG", 3, 47, "May 2026", "Memecoin season starts when the timeline says it's over. Long SOL."),
  ],
  "@lena_q": [omen("l-pin1", "BTC", "LONG", 2, 24, "Sep 2026", "Everyone's panic selling the FOMC candle. Bidding 61.2k, size small.")],
  "@8bitkay": [omen("k-pin1", "ETH", "LONG", 40, 164, "Sep 2026", "40x ETH before the upgrade. Either genius or my next liquidation post.")],
  "@tobi.sol": [omen("t-pin1", "ETH", "LONG", 50, 95, "Sep 2026", "50x ETH. The chart looked ready. It was ready.")],
};
