// Challenge options and their labels — shared by the client dialog
// (app/profile/[handle]/ChallengeDialog.tsx) and the server action that
// re-checks every value (app/profile/challengeActions.ts). Client-safe.
// Pulse only: accepting opens a private Pulse round, and 24h Portfolio has no
// head-to-head mode yet (Portfolio challenges sent earlier can only be
// declined). Markets, round lengths and stakes mirror the /duel lobby
// (app/duel/page.tsx TIMER_PRESETS, btc/eth markets, PULSE_WAGER_OPTIONS).
import { PULSE_WAGER_OPTIONS } from "@/lib/pulse";

export const PULSE_BLURB = "One live head-to-head round — higher P&L at the bell wins";

export const PULSE_MARKETS = [
  { id: "btc", label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  { id: "eth", label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
] as const;

export const PULSE_ROUNDS = [60, 120, 300];

// The round's wager, reserved from each player as they take their seat. The
// loser loses exactly this (the round's leveraged trading uses practice cash),
// so it's also the most either side can lose.
export const CHALLENGE_STAKES: readonly number[] = PULSE_WAGER_OPTIONS;

// Offered alongside the Ember presets: play for bragging rights only.
export const NO_STAKE = 0;

export const isChallengeStake = (stake: number) => stake === NO_STAKE || CHALLENGE_STAKES.includes(stake);

// A challenge has this long to be accepted, then it expires (lib/challenges.ts).
export const CHALLENGE_TTL_SECONDS = 120;
// Once accepted, the challenger has this long to take their seat before the
// round closes and the accepter's stake comes back.
export const ROUND_JOIN_SECONDS = 60;

// A pending challenge's countdown — the bell's rows and its card in a conversation. 95 → "1:35"
export const clockLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export const stakeLabel = (stake: number) => (stake === NO_STAKE ? "No stakes" : `${stake.toLocaleString("en-US")} Embers`);

// A pending challenge someone sent you, as the header bell gets it from the
// heartbeat (POST /api/presence). `handle` is null if the sender has none;
// `expiresInMs` is measured on the server when it answered.
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
  expiresInMs: number;
};

// A challenge you sent that was accepted, while its private round waits for
// you to take your seat (POST /api/presence). `href` joins it.
export type AcceptedChallenge = {
  id: string;
  handle: string | null;
  name: string;
  mode: string;
  market: string | null;
  timerSeconds: number | null;
  stake: number;
  href: string;
};

// "Pulse · BTC · 60s round · 100 Embers" / "24h Portfolio · No stakes"
export function challengeTerms(challenge: { mode: string; market: string | null; timerSeconds: number | null; stake: number }): string {
  const stake = stakeLabel(challenge.stake);
  if (challenge.mode === "portfolio") return `24h Portfolio · ${stake}`;
  return `Pulse · ${(challenge.market ?? "").toUpperCase()} · ${challenge.timerSeconds}s round · ${stake}`;
}
