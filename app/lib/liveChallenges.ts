"use client";

import { useSyncExternalStore } from "react";
import type { AcceptedChallenge, IncomingChallenge } from "@/app/lib/challengeRules";
import type { MessageSummary } from "@/app/lib/messageRules";
import { setMessageSummary } from "@/app/lib/messages";
import { getPlayerId } from "@/app/lib/playerId";
import { acceptChallenge, declineChallenge } from "@/app/profile/challengeActions";

// Your live challenges, shared by the one heartbeat (app/LiveChallenges.tsx)
// and every bell that shows them (app/NotificationsMenu.tsx — the header
// renders one per layout, desktop and mobile). Each heartbeat marks you
// online and replaces both lists: `challenges` sent to you and still pending,
// `accepted` = ones you sent whose private round is waiting for you to join.
// It also carries the Messages badge's unread counts (app/lib/messages.ts).

export type Answer = "accepted" | "declined";

// `expiresAt` is on this browser's clock: received time + the server's `expiresInMs`.
export type LiveIncoming = IncomingChallenge & { expiresAt: number };

type LiveChallengesState = { challenges: LiveIncoming[]; accepted: AcceptedChallenge[]; answers: Record<string, Answer> };

const EMPTY: LiveChallengesState = { challenges: [], accepted: [], answers: {} };
const listeners = new Set<() => void>();
let state = EMPTY;

function update(next: Partial<LiveChallengesState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLiveChallenges() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

const post = (body: object, keepalive = false) =>
  fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", keepalive });

/** Marks you online (POST /api/presence) and refreshes both lists and the message counts. Failures keep the last ones. */
export async function heartbeat(): Promise<void> {
  try {
    const response = await post({});
    if (!response.ok) return;
    const data: { challenges: IncomingChallenge[]; accepted: AcceptedChallenge[]; messages: MessageSummary | null } = await response.json();
    if (data.messages) setMessageSummary(data.messages);
    const receivedAt = Date.now();
    update({
      challenges: data.challenges.map((challenge) => ({ ...challenge, expiresAt: receivedAt + challenge.expiresInMs })),
      accepted: data.accepted,
    });
  } catch {
    // Offline or between deploys: the next beat retries.
  }
}

/** The tab is closing: offline now, not when the online window runs out. */
export function goAway() {
  post({ away: true }, true).catch(() => {});
}

// The bell row and popup both show an answer until the next heartbeat drops the challenge.
const answered = (id: string, answer: Answer) => update({ answers: { ...state.answers, [id]: answer } });

/** Opens the challenge's private round with you seated; `href` is the round to go to. */
export async function acceptIncoming(id: string): Promise<{ href: string } | { error: string }> {
  const result = await acceptChallenge(id, getPlayerId()).catch(() => ({ ok: false as const, error: "Couldn't accept — try again." }));
  if (!result.ok) return { error: result.error };
  answered(id, "accepted");
  return { href: result.href };
}

/** Null on success, else the error. */
export async function declineIncoming(id: string): Promise<string | null> {
  const result = await declineChallenge(id).catch(() => ({ ok: false as const, error: "Couldn't decline — try again." }));
  if (!result.ok) return result.error;
  answered(id, "declined");
  return null;
}

// A once-a-second clock for countdowns, shared by every row that shows one. 0
// until the first subscriber starts it (and on the server).
let now = 0;
let clock: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clock) {
    now = Date.now();
    clock = setInterval(() => {
      now = Date.now();
      clockListeners.forEach((tick) => tick());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clock) {
      clearInterval(clock);
      clock = null;
    }
  };
}

export function useNow() {
  return useSyncExternalStore(subscribeClock, () => now, () => 0);
}
