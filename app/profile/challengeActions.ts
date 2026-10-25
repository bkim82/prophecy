"use server";

import { refresh } from "next/cache";
import { PULSE_MARKETS, PULSE_ROUNDS, isChallengeStake } from "@/app/lib/challengeRules";
import { canChallenge, challengeTierNeeded } from "@/app/lib/rank";
import { ensureUser, refundBalance, reserveBalance } from "@/lib/balance";
import {
  cancelPendingChallenge,
  createChallenge,
  declinePendingChallenge,
  dismissDeclinedChallenge,
  expireStaleChallenges,
  openChallengeRound,
  pendingChallengeFor,
} from "@/lib/challenges";
import { followTarget, isFollowing } from "@/lib/follows";
import { saveMessage } from "@/lib/messages";
import { isOnline, touchPresence } from "@/lib/presence";
import { handleFor, rankForUser, storedProfileFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

// Pulse only (app/lib/challengeRules.ts).
export type ChallengeInput = {
  handle: string;
  market: string;
  timerSeconds: number;
  stake: number;
};

export type ChallengeResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a challenge from a profile's Challenge dialog — it shows in their
 * header bell and as a card in your conversation. Needs a handle of your
 * own. Re-checks everything the dialog offers: the target exists, you follow
 * each other (friends-only), you're both online (sending counts as you being
 * online), the one-tier-up rank gate,
 * Pulse market/round, stake preset (or no stakes), and that you could cover
 * the stake. Nothing is reserved — the stake is only a proposal until the
 * round it opens on accept is joined.
 */
export async function sendChallenge(input: ChallengeInput): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to send challenges." };
  // So the challenge's card shows in their conversation with you (lib/messages.ts lists people by handle).
  if (!(await handleFor(userId))) return { ok: false, error: "Choose your @handle before sending challenges." };

  const target = await followTarget(input.handle);
  if (!target) return { ok: false, error: "That trader doesn't exist." };
  if (target.userId === userId) return { ok: false, error: "You can't challenge yourself." };
  const [youFollow, theyFollow, viewerRank] = await Promise.all([
    isFollowing(userId, target.userId),
    isFollowing(target.userId, userId),
    rankForUser(userId),
  ]);
  if (!youFollow) return { ok: false, error: `Challenges are friends-only — follow ${target.name} first.` };
  if (!theyFollow) return { ok: false, error: `Challenges are friends-only — ${target.name} doesn't follow you back.` };
  const [, targetOnline] = await Promise.all([touchPresence(userId), isOnline(target.userId)]);
  if (!targetOnline) return { ok: false, error: `${target.name} just went offline — you can challenge them when you're both online.` };
  if (!canChallenge(target.rank, viewerRank)) {
    return { ok: false, error: `Reach ${challengeTierNeeded(target.rank)} to challenge ${target.name}.` };
  }
  const { market, timerSeconds } = input;
  if (!PULSE_MARKETS.some((option) => option.id === market)) return { ok: false, error: "Pick BTC or ETH." };
  if (!PULSE_ROUNDS.includes(Number(timerSeconds))) return { ok: false, error: "Pick a round length." };
  if (!isChallengeStake(input.stake)) return { ok: false, error: "Pick a stake." };

  const user = await ensureUser(userId);
  if (!user || user.balance < input.stake) return { ok: false, error: "You don't have enough Embers for that stake." };

  // A timed-out challenge to them would otherwise still hold the one-pending slot.
  await expireStaleChallenges(userId);
  const created = await createChallenge({
    challengerId: userId,
    challengerRank: viewerRank,
    targetHandle: target.handle,
    targetUserId: target.userId,
    targetRank: target.rank,
    mode: "pulse",
    market,
    timerSeconds,
    stake: input.stake,
  });
  if (created === "duplicate") return { ok: false, error: `You already have a challenge pending with ${target.name}.` };

  // It also lands in your conversation as a live card (app/MessagesDock.tsx).
  // The challenge stands even if that fails — the bell still shows it.
  await saveMessage(userId, target.userId, { body: "", photos: [], postId: null, challengeId: created.id }).catch((error: unknown) => {
    console.error("Posting the challenge to messages failed", error);
  });

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

export type AcceptResult = { ok: true; href: string } | { ok: false; error: string };

/**
 * Accepts a challenge from the header bell: Pulse only, the challenger still
 * online, your stake reserved, then its private round opens with you seated
 * (lib/challenges.ts openChallengeRound) and `href` takes you in. The
 * challenger's next heartbeat offers them seat 2; their stake is reserved
 * when they join (app/api/match/[id]/join). `playerId` is this browser's
 * match identity (app/lib/playerId.ts).
 */
export async function acceptChallenge(id: string, playerId: string): Promise<AcceptResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to answer challenges." };
  if (typeof playerId !== "string" || !playerId) return { ok: false, error: "Couldn't accept — reload and try again." };

  const challenge = await pendingChallengeFor(userId, id);
  if (!challenge) return { ok: false, error: "That challenge is no longer pending." };
  if (challenge.expired) return { ok: false, error: "That challenge expired — challenges last 2 minutes." };
  const { market, timerSeconds } = challenge;
  if (challenge.mode !== "pulse" || !market || !timerSeconds) {
    return { ok: false, error: "Only Pulse challenges can be accepted for now — decline this one." };
  }
  const [, challengerOnline] = await Promise.all([touchPresence(userId), isOnline(challenge.challengerId)]);
  if (!challengerOnline) {
    const name = (await storedProfileFor(challenge.challengerId))?.displayName ?? "Your challenger";
    return { ok: false, error: `${name} is offline — accept once you're both online.` };
  }
  if (!(await reserveBalance(userId, challenge.stake))) return { ok: false, error: "You don't have enough Embers for that stake." };

  let matchId: string | null;
  try {
    matchId = await openChallengeRound({ ...challenge, market, timerSeconds }, { userId, playerId });
  } catch (error) {
    await refundBalance(userId, challenge.stake);
    throw error;
  }
  if (!matchId) {
    await refundBalance(userId, challenge.stake);
    return { ok: false, error: "That challenge is no longer pending." };
  }
  return { ok: true, href: `/duel/${market}/pulse/${matchId}` };
}

// From the header bell. No refresh: the bell marks the row itself.
export async function declineChallenge(id: string): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to answer challenges." };
  if (!(await declinePendingChallenge(userId, id))) return { ok: false, error: "That challenge is no longer pending — it may have expired." };
  return { ok: true };
}

// Clears a declined or expired challenge from your own profile's sent list.
export async function dismissChallenge(id: string): Promise<ChallengeResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to manage challenges." };
  if (!(await dismissDeclinedChallenge(userId, id))) return { ok: false, error: "That challenge was already cleared." };
  refresh();
  return { ok: true };
}
