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
export const RANK_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "prophet", "oracle"] as const;
export type RankTier = (typeof RANK_TIERS)[number];
export type RoomId = RankTier;
export const isRoomId = (v: unknown): v is RoomId => RANK_TIERS.includes(v as RoomId);

// Tiers are percentile bands of the player base: the share (%) in each tier,
// read top-down — Oracle is the top 1%, Prophet the next 4%, and so on to the
// bottom 15% in Bronze. Sums to 100.
export const TIER_SHARE: Record<RankTier, number> = {
  oracle: 1,
  prophet: 4,
  diamond: 10,
  platinum: 20,
  gold: 20,
  silver: 30,
  bronze: 15,
};

// "Top X%" standing (0 = best player, 100 = worst) -> tier. Bands include
// their upper edge, so exactly top 1% is Oracle and top 5% is Prophet.
export function tierForPercentile(topPct: number): RankTier {
  let cutoff = 0;
  for (const tier of [...RANK_TIERS].reverse()) {
    cutoff += TIER_SHARE[tier];
    if (topPct <= cutoff) return tier;
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

// The signed-in viewer's rank for profile gating — hardcoded like the rest of
// this stub. (app/lib/roomsMocks.ts ROOM.subrank separately assumes
// "Oracle II" for Sanctum.)
export const VIEWER_RANK = "Gold II";

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

// The lowest tier that may challenge `targetRank` ("Oracle" -> "Prophet"),
// for the locked button's explanation.
export function challengeTierNeeded(targetRank: string): string {
  const tier = RANK_TIERS[Math.max(0, tierIndex(targetRank) - 1)];
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
