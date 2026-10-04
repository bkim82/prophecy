"use client";

import { useSyncExternalStore } from "react";
import type { TokenSearchResult } from "./types";

// Per-browser watchlist for the 24h Portfolio explorer. A viewer convenience,
// not game state, so it lives in localStorage rather than Postgres — it never
// affects a session and an empty/blocked storage just means an empty list.
// Stored as just enough to render a row before the live price lands.

export type WatchItem = Pick<TokenSearchResult, "address" | "symbol" | "name" | "imageUrl">;

const STORAGE_KEY = "pf-watchlist-v1";
const EMPTY: WatchItem[] = [];
const listeners = new Set<() => void>();
let items: WatchItem[] | null = null;

function read(): WatchItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is WatchItem => typeof item?.address === "string") : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snapshot() {
  items ??= read();
  return items;
}

function write(next: WatchItem[]) {
  items = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked — the list still works for this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    items = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWatchlist() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const has = (address: string) => list.some((item) => item.address === address);
  const toggle = (token: WatchItem) => {
    const current = snapshot();
    write(
      current.some((item) => item.address === token.address)
        ? current.filter((item) => item.address !== token.address)
        : [{ address: token.address, symbol: token.symbol, name: token.name, imageUrl: token.imageUrl }, ...current],
    );
  };
  return { list, has, toggle };
}
