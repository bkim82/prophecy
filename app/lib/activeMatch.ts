"use client";

// Tracks the one live duel this browser is currently playing, independent of
// which page is on screen. Lets a global bar offer "return to your duel" from
// anywhere, since leaving the room's page never calls `leave` and the match
// keeps running server-side (docs/multiplayer-plan.md).
const KEY = "activeMatch";
const EVENT = "activematch";
const QUEUEING_EVENT = "activematchqueueing";

// In-memory only: the lobby page's own "waiting for an opponent" panel
// already has first-class UI for that match, so the global return-to-match
// bar suppresses itself while it's on screen instead of stacking on top of it.
let queueing = false;

export type ActiveMatch = {
  matchId: string;
  market: string;
  mode: "quick-play" | "pulse";
};

export function activeMatchHref(match: ActiveMatch): string {
  return match.mode === "pulse"
    ? `/duel/${match.market}/pulse/${match.matchId}`
    : `/duel/${match.market}/match/${match.matchId}`;
}

export function getActiveMatch(): ActiveMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveMatch) : null;
  } catch {
    return null;
  }
}

export function setActiveMatch(match: ActiveMatch): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(match));
  } catch {
    // No persistence, no cross-page return prompt - not worth failing over.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

// Guarded by id so a stale room (already replaced by a newer match) can't
// clobber the pointer of whatever the player is doing now.
export function clearActiveMatch(matchId?: string): void {
  try {
    if (matchId) {
      const current = getActiveMatch();
      if (!current || current.matchId !== matchId) return;
    }
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeActiveMatch(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function setQueueing(value: boolean): void {
  queueing = value;
  window.dispatchEvent(new CustomEvent(QUEUEING_EVENT));
}

export function isQueueing(): boolean {
  return queueing;
}

export function subscribeQueueing(onChange: () => void): () => void {
  window.addEventListener(QUEUEING_EVENT, onChange);
  return () => window.removeEventListener(QUEUEING_EVENT, onChange);
}
