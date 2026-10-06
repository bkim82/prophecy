"use server";

import { auth } from "@clerk/nextjs/server";
import { refresh } from "next/cache";
import { CHALLENGE_STAKES, PULSE_MARKETS, PULSE_ROUNDS, isChallengeMode, type ChallengeMode } from "@/app/lib/challengeRules";
import { getProfile } from "@/app/lib/mockProfiles";
import { VIEWER_RANK, canChallenge, challengeTierNeeded } from "@/app/lib/rank";
import { ensureUser } from "@/lib/balance";
import { cancelPendingChallenge, createChallenge } from "@/lib/challenges";

export type ChallengeInput = {
  handle: string;
  mode: ChallengeMode;
  market?: string;
  timerSeconds?: number;
  stake: number;
};

export type ChallengeResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a challenge from a profile's Challenge dialog. Re-checks everything
 * the dialog offers: the target exists, the one-tier-up rank gate, mode,
 * Pulse market/round, stake preset, and that you could cover the stake.
 * Nothing is reserved — the stake is only a proposal until it's accepted.
 */
export async function sendChallenge(input: ChallengeInput): Promise<ChallengeResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to send challenges." };

  const target = getProfile(input.handle);
  if (!target) return { ok: false, error: "That trader doesn't exist." };
  if (!canChallenge(target.rank, VIEWER_RANK)) {
    return { ok: false, error: `Reach ${challengeTierNeeded(target.rank)} to challenge ${target.name}.` };
  }
  if (!isChallengeMode(input.mode)) return { ok: false, error: "Pick Pulse or 24h Portfolio." };

  const pulse = input.mode === "pulse";
  const market = pulse ? input.market : undefined;
  const timerSeconds = pulse ? input.timerSeconds : undefined;
  if (pulse && !PULSE_MARKETS.some((option) => option.id === market)) return { ok: false, error: "Pick BTC or ETH." };
  if (pulse && !PULSE_ROUNDS.includes(Number(timerSeconds))) return { ok: false, error: "Pick a round length." };
  if (!CHALLENGE_STAKES[input.mode].includes(input.stake)) return { ok: false, error: "Pick a stake." };

  const user = await ensureUser(userId);
  if (!user || user.balance < input.stake) return { ok: false, error: "You don't have enough Embers for that stake." };

  const created = await createChallenge({
    challengerId: userId,
    challengerRank: VIEWER_RANK,
    targetHandle: target.handle,
    targetRank: target.rank,
    mode: input.mode,
    market: market ?? null,
    timerSeconds: timerSeconds ?? null,
    stake: input.stake,
  });
  if (created === "duplicate") return { ok: false, error: `You already have a challenge pending with ${target.name}.` };

  refresh();
  return { ok: true };
}

export async function cancelChallenge(id: string): Promise<ChallengeResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to manage challenges." };
  if (!(await cancelPendingChallenge(userId, id))) return { ok: false, error: "That challenge is no longer pending." };
  refresh();
  return { ok: true };
}
