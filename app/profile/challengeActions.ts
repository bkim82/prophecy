"use server";

import { refresh } from "next/cache";
import { PULSE_MARKETS, PULSE_ROUNDS, isChallengeMode, isChallengeStake, type ChallengeMode } from "@/app/lib/challengeRules";
import { VIEWER_RANK, canChallenge, challengeTierNeeded } from "@/app/lib/rank";
import { ensureUser } from "@/lib/balance";
import { cancelPendingChallenge, createChallenge, declinePendingChallenge, dismissDeclinedChallenge } from "@/lib/challenges";
import { followTarget, isFollowing } from "@/lib/follows";
import { getViewer } from "@/lib/viewer";

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
 * the dialog offers: the target exists, you follow each other (friends-only,
 * so mock traders — who never follow back — can't be challenged), the
 * one-tier-up rank gate, mode, Pulse market/round, stake preset (or no
 * stakes), and that you could cover the stake. Nothing is reserved — the
 * stake is only a proposal until it's accepted.
 */
export async function sendChallenge(input: ChallengeInput): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to send challenges." };

  const target = await followTarget(input.handle);
  if (!target) return { ok: false, error: "That trader doesn't exist." };
  if (target.userId === userId) return { ok: false, error: "You can't challenge yourself." };
  const [youFollow, theyFollow] = await Promise.all([
    isFollowing(userId, target.key),
    target.userId ? isFollowing(target.userId, userId) : false,
  ]);
  if (!youFollow) return { ok: false, error: `Challenges are friends-only — follow ${target.name} first.` };
  if (!theyFollow) return { ok: false, error: `Challenges are friends-only — ${target.name} doesn't follow you back.` };
  if (!canChallenge(target.rank, VIEWER_RANK)) {
    return { ok: false, error: `Reach ${challengeTierNeeded(target.rank)} to challenge ${target.name}.` };
  }
  if (!isChallengeMode(input.mode)) return { ok: false, error: "Pick Pulse or 24h Portfolio." };

  const pulse = input.mode === "pulse";
  const market = pulse ? input.market : undefined;
  const timerSeconds = pulse ? input.timerSeconds : undefined;
  if (pulse && !PULSE_MARKETS.some((option) => option.id === market)) return { ok: false, error: "Pick BTC or ETH." };
  if (pulse && !PULSE_ROUNDS.includes(Number(timerSeconds))) return { ok: false, error: "Pick a round length." };
  if (!isChallengeStake(input.mode, input.stake)) return { ok: false, error: "Pick a stake." };

  const user = await ensureUser(userId);
  if (!user || user.balance < input.stake) return { ok: false, error: "You don't have enough Embers for that stake." };

  const created = await createChallenge({
    challengerId: userId,
    challengerRank: VIEWER_RANK,
    targetHandle: target.handle,
    targetUserId: target.userId,
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
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to manage challenges." };
  if (!(await cancelPendingChallenge(userId, id))) return { ok: false, error: "That challenge is no longer pending." };
  refresh();
  return { ok: true };
}

// From the header bell. No refresh: the bell marks the row itself.
export async function declineChallenge(id: string): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to answer challenges." };
  if (!(await declinePendingChallenge(userId, id))) return { ok: false, error: "That challenge is no longer pending." };
  return { ok: true };
}

// Clears a declined challenge from your own profile's sent list.
export async function dismissChallenge(id: string): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to manage challenges." };
  if (!(await dismissDeclinedChallenge(userId, id))) return { ok: false, error: "That challenge was already cleared." };
  refresh();
  return { ok: true };
}
