// How someone trades, for the profile hero and highlight reel
// (app/profile/[handle]/ProfileView.tsx, HighlightReel.tsx): per-asset call
// accuracy, the signature asset derived from it, a trading archetype, and the
// pinned highlights, plus the all-time records behind the achievements rail.
// Client-safe. Every number comes from what the account played: settled
// Arena matches and 24h Portfolio activity (lib/activity.ts, lib/match.ts).
import type { Market, Side } from "@/app/lib/posts";

// `accuracy` = share of settled calls on that asset that came true.
export type AssetAccuracy = { asset: string; accuracy: number; calls: number };

export const ASSET_META: Record<string, { symbol: string; symbolClass: string }> = {
  BTC: { symbol: "₿", symbolClass: "btc-symbol" },
  ETH: { symbol: "Ξ", symbolClass: "eth-symbol" },
  DOGE: { symbol: "Ð", symbolClass: "doge-symbol" },
  SOL: { symbol: "◎", symbolClass: "sol-symbol" },
};

// The asset they call most; a tie goes to the more accurate one.
export function signatureAsset(rows: AssetAccuracy[]): AssetAccuracy | null {
  return rows.reduce<AssetAccuracy | null>(
    (best, row) => (!best || row.calls > best.calls || (row.calls === best.calls && row.accuracy > best.accuracy) ? row : best),
    null,
  );
}

// Best three by accuracy, as in "BTC 78% · SOL 61% · ETH 40%".
export const accuracyLine = (rows: AssetAccuracy[]) => [...rows].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3);

export const accuracyTone = (accuracy: number) => (accuracy >= 0.6 ? "is-up" : accuracy < 0.45 ? "is-down" : "");

// Behavior behind the archetype. `pulseShare` = calls that were short Pulse
// rounds; `fadeShare` = shorts plus calls against the prevailing move.
export type TradingStyle = { pulseShare: number; avgHoldHours: number; fadeShare: number; avgLeverage: number };

// The own-profile copy-trading card. Nothing can be copied yet — the feed's
// Copy button (app/PostCard.tsx) is unwired and there's no copy-trade ledger.
export type CopyEarnings = {
  // Distinct traders who copied at least one of your trades.
  copiers: number;
  // Copied positions across all of them.
  copies: number;
  // USD paid out to you from copiers' trades.
  earned: number;
};

export type ArchetypeId = "daredevil" | "contrarian" | "patient" | "swift";

export const ARCHETYPES: Record<ArchetypeId, { name: string; blurb: string }> = {
  swift: { name: "The Swift", blurb: "Mostly short Pulse rounds" },
  patient: { name: "The Patient", blurb: "Holds calls for days" },
  contrarian: { name: "The Contrarian", blurb: "Mostly fades and shorts" },
  daredevil: { name: "The Daredevil", blurb: "Consistently high leverage" },
};

// First rule that matches wins, most distinctive first: a 25× scalper is a
// Daredevil before a Swift. No match → no archetype shown.
const ARCHETYPE_RULES: [ArchetypeId, (style: TradingStyle) => boolean][] = [
  ["daredevil", (style) => style.avgLeverage >= 20],
  ["contrarian", (style) => style.fadeShare >= 0.55],
  ["patient", (style) => style.avgHoldHours >= 48],
  ["swift", (style) => style.pulseShare >= 0.6],
];

export function archetypeFor(style: TradingStyle | undefined): ArchetypeId | null {
  return (style && ARCHETYPE_RULES.find(([, matches]) => matches(style))?.[0]) ?? null;
}

// Highlight reel: up to three pinned wins shown above the tabs with the gold
// ✦ Fulfilled chip. You pin won Arena matches; the "omen" kind (a fulfilled
// call) has no saved form yet.
export const MAX_PINS = 3;

export type Highlight =
  | { kind: "omen"; id: string; asset: string; side: "LONG" | "SHORT"; leverage: number; roi: number; text: string; date: string }
  | { kind: "match"; id: string; asset: string; opponent: string; round: string; profit: number; net: number; date: string };

// Pinnable = a win that also made money (a "won" round can still be red if the opponent lost more).
export const isPinnableMatch = (match: { result: string; yourProfit: number | null }) =>
  match.result === "won" && (match.yourProfit ?? 0) > 0;

// `market` is a Pulse market ("btc") or a Portfolio token symbol. No
// side/leverage = a whole Pulse round, which keeps only its P&L.
export type BestTrade = { market: Market | string; side?: Side; leverage?: number; roi: number; date: string };

// All-time records for the achievements rail (app/profile/[handle]/ProfileAchievements.tsx),
// from what the account played (lib/activity.ts), with null where there's nothing to show yet.
export type ProfileRecords = {
  // Always null: there's no Elo system, so the card shows rank alone.
  peakElo: number | null;
  peakRank: string;
  bestTrade: BestTrade | null;
  // Most wins in a row: fulfilled calls, or Arena rounds when `unit` says so.
  longestStreak: number;
  // Fraction of settled calls fulfilled / rounds won; null before any.
  winRate: number | null;
  calls: number;
  unit?: "rounds";
  // Best 24h Portfolio session, % P&L.
  bestSession: number | null;
  duelsWon: number;
};
