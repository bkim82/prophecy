"use client";

import { useSyncExternalStore } from "react";

// Per-browser set of coins hidden from the Portfolio list (spam airdrops,
// dust). A display preference only — same localStorage store shape as
// app/duel/portfolio/watchlist.ts. Hidden coins stay sendable/swappable; they
// just drop out of the list and the balance total.

const STORAGE_KEY = "wd-hidden-coins-v1";
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let addresses: string[] | null = null;

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snapshot() {
  addresses ??= read();
  return addresses;
}

function write(next: string[]) {
  addresses = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked — hiding still works for this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    addresses = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHiddenCoins() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const isHidden = (address: string) => list.includes(address);
  const toggle = (address: string) => {
    const current = snapshot();
    write(current.includes(address) ? current.filter((item) => item !== address) : [...current, address]);
  };
  return { isHidden, toggle };
}
