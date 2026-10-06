"use client";

import { useMemo, useSyncExternalStore } from "react";
import { DEFAULT_INTERESTS, isTopicId, type TopicId } from "@/app/lib/topics";

// Per-browser Bookmarked / Interests / Not interested lists for the Omens
// feed (app/FeedSwitcher.tsx). Viewer conveniences over mock posts, so they live in
// localStorage like the Portfolio watchlist (app/duel/portfolio/watchlist.ts);
// empty/blocked storage just means empty (or default) lists. Stored as ids only.

const EMPTY: string[] = [];

// `fallback` is the list before this browser has ever saved one.
function createIdStore(key: string, fallback: string[] = EMPTY) {
  const listeners = new Set<() => void>();
  let ids: string[] | null = null;

  function read(): string[] {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : fallback;
    } catch {
      return fallback;
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
const interests = createIdStore("omens-interests-v2", DEFAULT_INTERESTS);
const mutedTopics = createIdStore("omens-muted-topics-v1");

export function useBookmarks() {
  const ids = useSyncExternalStore(bookmarks.subscribe, bookmarks.snapshot, () => EMPTY);
  const toggle = (id: string) => {
    const current = bookmarks.snapshot();
    bookmarks.write(current.includes(id) ? current.filter((other) => other !== id) : [id, ...current]);
  };
  return { ids, has: (id: string) => ids.includes(id), toggle };
}

// Followed topics, in the order they were added — that order is the order of
// the For You covers. Unknown ids (a topic since removed) are dropped.
export function useInterests() {
  const stored = useSyncExternalStore(interests.subscribe, interests.snapshot, () => DEFAULT_INTERESTS);
  const ids = useMemo(() => stored.filter(isTopicId), [stored]);
  const toggle = (id: TopicId) => {
    const current = interests.snapshot();
    if (current.includes(id)) {
      interests.write(current.filter((other) => other !== id));
      return;
    }
    interests.write([...current, id]);
    // Following a topic takes back an earlier "Not interested".
    mutedTopics.write(mutedTopics.snapshot().filter((other) => other !== id));
  };
  return { ids, has: (id: TopicId) => ids.includes(id), toggle };
}

// "Not interested" topics: kept out of the For You suggestions (covers, the
// feed under them, Mix it up). Muting also unfollows; `mute` returns where the
// topic sat in your interests (-1 if it wasn't followed) so an Undo can put it
// back in the same spot.
export function useMutedTopics() {
  const stored = useSyncExternalStore(mutedTopics.subscribe, mutedTopics.snapshot, () => EMPTY);
  const ids = useMemo(() => stored.filter(isTopicId), [stored]);
  const mute = (id: TopicId) => {
    const followed = interests.snapshot();
    const followAt = followed.indexOf(id);
    if (followAt >= 0) interests.write(followed.filter((other) => other !== id));
    const current = mutedTopics.snapshot();
    if (!current.includes(id)) mutedTopics.write([...current, id]);
    return followAt;
  };
  const unmute = (id: TopicId, followAt = -1) => {
    mutedTopics.write(mutedTopics.snapshot().filter((other) => other !== id));
    if (followAt < 0) return;
    const followed = interests.snapshot().filter((other) => other !== id);
    interests.write([...followed.slice(0, followAt), id, ...followed.slice(followAt)]);
  };
  return { ids, has: (id: TopicId) => ids.includes(id), mute, unmute };
}
