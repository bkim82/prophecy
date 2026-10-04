"use client";

import { useEffect, useState } from "react";

// Client-side history cache for the wallet dashboard, same shape/pattern as
// app/duel/portfolio/ui.tsx's useTokenHistory but pointed at the no-auth
// /api/wallet/history route (the wallet page has no Clerk sign-in gate).

export type WalletHistoryPeriod = "1h" | "24h" | "7d" | "30d";
export const WALLET_HISTORY_PERIODS: WalletHistoryPeriod[] = ["1h", "24h", "7d", "30d"];

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 15_000;
const TICK_MS = 1_000;
const cache = new Map<string, { closes: number[] | null; retry: boolean; dueAt: number }>();

export type WalletHistoryStatus = "ready" | "loading" | "none";

export function useWalletHistory(addresses: string[], period: WalletHistoryPeriod = "24h") {
  const key = Array.from(new Set(addresses.map((address) => address.toLowerCase()))).sort().join(",");
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let busy = false;
    const load = async () => {
      if (busy) return;
      const now = Date.now();
      const wanted = key.split(",").filter((address) => {
        const cached = cache.get(`${period}:${address}`);
        return !cached || now >= cached.dueAt;
      });
      if (wanted.length === 0) return;
      busy = true;
      const markRetry = (address: string, delayMs = RETRY_MS) => {
        const previous = cache.get(`${period}:${address}`);
        const at = Date.now();
        cache.set(`${period}:${address}`, { closes: previous?.closes ?? null, retry: !previous?.closes, dueAt: at + delayMs });
      };
      const markFetched = (address: string, closes: number[] | null) => {
        cache.set(`${period}:${address}`, { closes, retry: false, dueAt: Date.now() + REFRESH_MS });
      };
      try {
        const res = await fetch("/api/wallet/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: wanted, period }),
        });
        if (!res.ok) { wanted.forEach((address) => markRetry(address)); return; }
        const data = (await res.json()) as { history: Record<string, number[]>; retry?: string[]; retryAfterMs?: number | null };
        const retry = new Set(data.retry ?? []);
        const retryDelay = data.retryAfterMs ? data.retryAfterMs + 250 + Math.random() * 750 : RETRY_MS;
        for (const address of wanted) {
          const closes = data.history[address];
          if (closes) markFetched(address, closes);
          else if (retry.has(address)) markRetry(address, retryDelay);
          else markFetched(address, null);
        }
      } catch {
        wanted.forEach((address) => markRetry(address));
      } finally {
        busy = false;
        if (!cancelled) setVersion((v) => v + 1);
      }
    };
    load();
    const id = setInterval(load, TICK_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [key, period]);

  const entry = (address: string) => cache.get(`${period}:${address.toLowerCase()}`);
  const lookup = (address: string) => entry(address)?.closes ?? undefined;
  const status = (address: string): WalletHistoryStatus => {
    const cached = entry(address);
    if (cached?.closes) return "ready";
    return cached && !cached.retry ? "none" : "loading";
  };
  return { lookup, status };
}
