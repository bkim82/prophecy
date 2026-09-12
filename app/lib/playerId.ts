"use client";

// Anonymous, per-browser identity. Quick Play needs to tell two tabs apart, not
// to know who anyone is — Clerk sign-in stays optional and unrelated. Two
// windows of the same profile share this id; use a private window for a 2nd
// player on one machine.
const KEY = "playerId";

let memoryId: string | null = null;

const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/**
 * Client-only: call from an effect or an event handler, never during render on
 * the server. Falls back to a per-session id when storage is blocked.
 */
export function getPlayerId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const id = memoryId ?? newId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    memoryId ??= newId();
    return memoryId;
  }
}
