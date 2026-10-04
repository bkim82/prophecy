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
export const RANK_TIERS = ["bronze", "silver", "gold", "diamond", "oracle"] as const;
export type RankTier = (typeof RANK_TIERS)[number];
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

// The signed-in viewer's rank for profile gating — hardcoded like the rest of
// this stub. (app/lib/roomsMocks.ts ROOM.subrank separately assumes
// "Oracle II" for Sanctum.)
export const VIEWER_RANK = "Gold II";

// A profile's portfolio is visible to viewers at or above that profile's rank.
export function canViewPortfolio(profileRank: string, viewerRank: string = VIEWER_RANK): boolean {
  return rankScore(viewerRank) >= rankScore(profileRank);
}
