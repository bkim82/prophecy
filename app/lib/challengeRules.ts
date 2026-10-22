// Challenge options and their labels — shared by the client dialog
// (app/profile/[handle]/ChallengeDialog.tsx) and the server action that
// re-checks every value (app/profile/challengeActions.ts). Client-safe.
// Pulse options mirror the /duel lobby (app/duel/page.tsx TIMER_PRESETS,
// btc/eth markets); 24h Portfolio stakes mirror SessionStrip's presets.

export type ChallengeMode = "pulse" | "portfolio";

export const CHALLENGE_MODES: Record<ChallengeMode, { label: string; blurb: string }> = {
  pulse: { label: "Pulse", blurb: "One live head-to-head round — higher P&L at the bell wins" },
  portfolio: { label: "24h Portfolio", blurb: "Both trade a 24-hour session — higher P&L % wins" },
};

export const PULSE_MARKETS = [
  { id: "btc", label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  { id: "eth", label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
] as const;

export const PULSE_ROUNDS = [60, 120, 300];

export const CHALLENGE_STAKES: Record<ChallengeMode, number[]> = {
  pulse: [100, 250, 500],
  portfolio: [100, 500, 1000],
};

// Offered alongside every mode's Ember presets: play for bragging rights only.
export const NO_STAKE = 0;

export const isChallengeStake = (mode: ChallengeMode, stake: number) => stake === NO_STAKE || CHALLENGE_STAKES[mode].includes(stake);

export const stakeLabel = (stake: number) => (stake === NO_STAKE ? "No stakes" : `${stake.toLocaleString("en-US")} Embers`);

// A pending challenge someone sent you, as the header bell gets it from
// GET /api/challenges/incoming. `handle` is null if the sender has none.
export type IncomingChallenge = {
  id: string;
  handle: string | null;
  name: string;
  rank: string;
  mode: string;
  market: string | null;
  timerSeconds: number | null;
  stake: number;
  sentLabel: string;
};

export const isChallengeMode = (value: unknown): value is ChallengeMode => value === "pulse" || value === "portfolio";

// "Pulse · BTC · 60s round · 100 Embers" / "24h Portfolio · No stakes"
export function challengeTerms(challenge: { mode: string; market: string | null; timerSeconds: number | null; stake: number }): string {
  const stake = stakeLabel(challenge.stake);
  if (challenge.mode === "portfolio") return `24h Portfolio · ${stake}`;
  return `Pulse · ${(challenge.market ?? "").toUpperCase()} · ${challenge.timerSeconds}s round · ${stake}`;
}
