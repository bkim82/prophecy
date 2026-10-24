// STUB — no rank/tier system exists anywhere in the app yet (no columns on
// `users` in db/schema.ts, no elo/rank logic in lib/match.ts). This hardcodes
// a placeholder rank and threshold so /exclusive and the profile Portfolio
// tab (app/profile/[handle]/page.tsx) have something to gate on.
// Replace with a real per-user computation (tied to the signed-in Clerk
// userId) in a future pass — see docs/roadmap.md "Not built".
export const MOCK_CURRENT_RANK = 3;
export const MOCK_RANK_THRESHOLD = 7;
export const MOCK_RANK_LABEL = "Silver III";
export const MOCK_RANK_THRESHOLD_LABEL = "Gold I";

export function isExclusiveUnlocked(rank: number = MOCK_CURRENT_RANK): boolean {
  return rank >= MOCK_RANK_THRESHOLD;
}

// Rank labels are "<Tier> <Division>" ("Gold II") or a bare tier ("Oracle").
// Tiers climb bronze → oracle; divisions count UP, so Gold III outranks
// Gold II outranks Gold I. A bare tier sorts below every division of it.
// Each tier keys a [data-room]/[data-rank] colour set in globals.css and a
// door style in the Sanctum entry gate.
export const RANK_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "oracle"] as const;
export type RankTier = (typeof RANK_TIERS)[number];
export type RoomId = RankTier;
export const isRoomId = (v: unknown): v is RoomId => RANK_TIERS.includes(v as RoomId);

// Tiers are earned with rating points; everyone starts in Bronze (under
// 1,500). Silver → Platinum are points alone. Diamond and Oracle also need a
// "top X%" standing, a career match count, and (Oracle) a win rate over the
// last RECENT_MATCHES — miss any of those and you hold the tier below, e.g.
// 9,000 points outside the top 10% stays Platinum.
type TierRequirement = { minPoints: number; topPct?: number; minMatches?: number; minRecentWinRate?: number };

export const RECENT_MATCHES = 50;

export const TIER_REQUIREMENTS: Record<RankTier, TierRequirement> = {
  bronze: { minPoints: 0 },
  silver: { minPoints: 1500 },
  gold: { minPoints: 2500 },
  platinum: { minPoints: 4000 },
  diamond: { minPoints: 7500, topPct: 10, minMatches: 100 },
  oracle: { minPoints: 15000, topPct: 1, minMatches: 200, minRecentWinRate: 55 },
};

// topPct: 0 = best player, 100 = worst; recentWinRate: % won of the last
// RECENT_MATCHES. Percent edges are inclusive (exactly top 1% is Oracle).
export type TierStanding = { points: number; topPct: number; matches: number; recentWinRate: number };

export function tierForStanding(s: TierStanding): RankTier {
  for (const tier of [...RANK_TIERS].reverse()) {
    const req = TIER_REQUIREMENTS[tier];
    if (
      s.points >= req.minPoints &&
      s.topPct <= (req.topPct ?? 100) &&
      s.matches >= (req.minMatches ?? 0) &&
      s.recentWinRate >= (req.minRecentWinRate ?? 0)
    ) return tier;
  }
  return "bronze";
}
const DIVISIONS = ["I", "II", "III", "IV", "V"]; // low → high

// "Gold II" -> "gold". Drives data-rank, which keys the tier color tokens and
// rank-badge styles in app/globals.css.
export function rankTier(rank?: string): RankTier | undefined {
  const tier = rank?.split(" ")[0].toLowerCase();
  return RANK_TIERS.find((t) => t === tier);
}

export function rankScore(rank: string): number {
  const [tierWord = "", division = ""] = rank.split(" ");
  const tier = RANK_TIERS.indexOf(tierWord.toLowerCase() as RankTier);
  return tier * 10 + DIVISIONS.indexOf(division) + 1;
}

// Every real account's rank — the signed-in viewer's and anyone else's — until
// ranking exists: everyone starts at the bottom, Bronze I, except the handles
// in RANK_OVERRIDES. Gates profile portfolios and challenges.
// (app/lib/rooms.ts ROOM.subrank separately assumes "Oracle II" for Sanctum.)
export const VIEWER_RANK = "Bronze I";

// Hand-granted ranks by real-account handle (stored form: lowercase, no "@").
const RANK_OVERRIDES = new Map<string, string>([
  ["bkim", "Oracle III"],
  ["danielson", "Oracle III"],
]);

// A real account's rank by handle ("@bkim" or "bkim"); no handle → VIEWER_RANK.
export function rankForHandle(handle?: string | null): string {
  return (handle && RANK_OVERRIDES.get(handle.replace(/^@/, "").toLowerCase())) || VIEWER_RANK;
}

// A profile's portfolio is visible to viewers at or above that profile's rank.
export function canViewPortfolio(profileRank: string, viewerRank: string = VIEWER_RANK): boolean {
  return rankScore(viewerRank) >= rankScore(profileRank);
}

// Challenge gate: you can challenge anyone at most one tier above your own.
// Tiers only — divisions don't matter, so any Silver can challenge any Gold
// but no Platinum, and an Oracle can challenge everyone. Checked again on the
// server when a challenge is sent (app/profile/challengeActions.ts).
const tierIndex = (rank: string) => {
  const tier = rankTier(rank);
  return tier ? RANK_TIERS.indexOf(tier) : -1;
};

export function canChallenge(targetRank: string, viewerRank: string = VIEWER_RANK): boolean {
  const target = tierIndex(targetRank);
  const viewer = tierIndex(viewerRank);
  return target >= 0 && viewer >= 0 && target <= viewer + 1;
}

// The lowest tier that may challenge `targetRank` ("Oracle" -> "Diamond"),
// for the locked button's explanation.
export function challengeTierNeeded(targetRank: string): string {
  const tier = RANK_TIERS[Math.max(0, tierIndex(targetRank) - 1)];
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
