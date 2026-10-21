"use client";

import { useSyncExternalStore } from "react";

// The omen this tab just published (POST /api/posts from /compose or the
// feed's inline composer): FeedSwitcher flashes it once when it arrives in the
// server-rendered feed, then clears it.

let fresh: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: string | null) {
  if (fresh === next) return;
  fresh = next;
  for (const listener of listeners) listener();
}

export const markFreshPost = (id: string) => set(id);
export const clearFreshPost = () => set(null);
export const useFreshPostId = () => useSyncExternalStore(subscribe, () => fresh, () => null);
