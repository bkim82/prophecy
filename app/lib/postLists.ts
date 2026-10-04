"use client";

import { useSyncExternalStore } from "react";

// Per-browser Bookmarked / Recently viewed lists for the Omens feed rail
// (app/FeedSwitcher.tsx). Viewer conveniences over mock posts, so they live in
// localStorage like the Portfolio watchlist (app/duel/portfolio/watchlist.ts);
// empty/blocked storage just means empty lists. Stored as post ids only.

const EMPTY: string[] = [];
const RECENT_LIMIT = 5;

function createIdStore(key: string) {
  const listeners = new Set<() => void>();
  let ids: string[] | null = null;

  function read(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  function snapshot() {
    ids ??= read();
    return ids;
  }

  function write(next: string[]) {
    ids = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked — the list still works for this page view.
    }
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // Another tab changed it.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      ids = read();
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { snapshot, write, subscribe };
}

const bookmarks = createIdStore("omens-bookmarks-v1");
const recent = createIdStore("omens-recent-v1");

export function useBookmarks() {
  const ids = useSyncExternalStore(bookmarks.subscribe, bookmarks.snapshot, () => EMPTY);
  const toggle = (id: string) => {
    const current = bookmarks.snapshot();
    bookmarks.write(current.includes(id) ? current.filter((other) => other !== id) : [id, ...current]);
  };
  return { ids, has: (id: string) => ids.includes(id), toggle };
}

export function useRecentlyViewed() {
  const ids = useSyncExternalStore(recent.subscribe, recent.snapshot, () => EMPTY);
  return { ids, clear: () => recent.write([]) };
}

// Most recent first; re-viewing a post moves it back to the top.
export function markViewed(id: string) {
  const current = recent.snapshot();
  if (current[0] === id) return;
  recent.write([id, ...current.filter((other) => other !== id)].slice(0, RECENT_LIMIT));
}
