// STUB — no rank/tier system exists anywhere in the app yet (no columns on
// `users` in db/schema.ts, no elo/rank logic in lib/match.ts). This hardcodes
// a placeholder rank and threshold so /exclusive has something to gate on.
// Replace with a real per-user computation (tied to the signed-in Clerk
// userId) in a future pass — see docs/roadmap.md "Not built".
export const MOCK_CURRENT_RANK = 3;
export const MOCK_RANK_THRESHOLD = 7;
export const MOCK_RANK_LABEL = "Silver III";
export const MOCK_RANK_THRESHOLD_LABEL = "Gold I";

export function isExclusiveUnlocked(rank: number = MOCK_CURRENT_RANK): boolean {
  return rank >= MOCK_RANK_THRESHOLD;
}

// Rank tiers, lowest first. Each keys a [data-room]/[data-rank] colour set in
// globals.css and a door style in the Sanctum entry gate.
export const RANK_TIERS = ["bronze", "silver", "gold", "diamond", "oracle"] as const;
export type RoomId = (typeof RANK_TIERS)[number];
export const isRoomId = (v: unknown): v is RoomId => RANK_TIERS.includes(v as RoomId);
