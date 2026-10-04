// GeckoTerminal wrapper for the two things DexScreener's public API lacks:
// price history (sparklines/charts) and trending/new-on-Base lists. Free,
// key-less, but only ~30 req/min shared across this whole server — so every
// call goes through a rolling per-minute budget kept well under that, and
// results are cached for minutes, not seconds. Over budget or on failure we
// serve the last cached value (or nothing): history is decoration, never a
// reason to fail a request. Prices/trading stay on lib/basePrices.ts.

import { getTokenMetas, getTokenSummaries, type TokenSearchResult } from "@/lib/basePrices";

const TRENDING_TTL_MS = 3 * 60_000;
const BUDGET_PER_MIN = 20;
const TRENDING_LIMIT = 20;
const NEW_MIN_LIQUIDITY_USD = 10_000; // most brand-new pools are empty or rugs — only list ones with real depth

/** Chart windows: GeckoTerminal OHLCV timeframe/aggregate/limit per period, plus how long a result stays cached. */
export const HISTORY_PERIODS = {
  "1h": { timeframe: "minute", aggregate: 1, limit: 60, ttlMs: 60_000 },
  "24h": { timeframe: "hour", aggregate: 1, limit: 24, ttlMs: 5 * 60_000 },
  "7d": { timeframe: "hour", aggregate: 4, limit: 42, ttlMs: 15 * 60_000 },
  "30d": { timeframe: "day", aggregate: 1, limit: 30, ttlMs: 60 * 60_000 },
} as const;
export type HistoryPeriod = keyof typeof HISTORY_PERIODS;
export const isHistoryPeriod = (value: unknown): value is HistoryPeriod =>
  typeof value === "string" && Object.hasOwn(HISTORY_PERIODS, value);

// Quote/base assets that show up in Base trending pools but aren't coins anyone is here to trade.
const NOT_TRADEABLE = new Set([
  "0x4200000000000000000000000000000000000006", // WETH
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // EURC
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
]);

const historyCache = new Map<string, { at: number; closes: number[] }>(); // keyed `${period}:${address}`
type PoolList = { addresses: string[]; images: Map<string, string> };
const listCache = new Map<"trending" | "new", { at: number } & PoolList>();
const inFlight = new Map<string, Promise<unknown>>();
let budgetWindow: number[] = [];

function takeBudget() {
  const now = Date.now();
  budgetWindow = budgetWindow.filter((at) => now - at < 60_000);
  if (budgetWindow.length >= BUDGET_PER_MIN) return false;
  budgetWindow.push(now);
  return true;
}

/** Ms until the oldest budgeted call ages out of the window, or 0 when there's a slot free now. */
function budgetFreesIn() {
  const now = Date.now();
  budgetWindow = budgetWindow.filter((at) => now - at < 60_000);
  if (budgetWindow.length < BUDGET_PER_MIN) return 0;
  return Math.max(0, 60_000 - (now - budgetWindow[0]));
}

function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Closes, "none" when the pool genuinely has no candles, or null when we couldn't ask (budget, rate limit, network). */
async function fetchHistory(pairAddress: string, period: HistoryPeriod): Promise<number[] | "none" | null> {
  if (!takeBudget()) return null;
  const { timeframe, aggregate, limit } = HISTORY_PERIODS[period];
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=base`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    // Rate-limit errors can arrive as HTTP 200 with no `data` — that's "try later", not "no history".
    const candles = data.data?.attributes?.ohlcv_list;
    if (!Array.isArray(candles)) return null;
    // Newest-first [ts, open, high, low, close, volume] → oldest-first closes.
    const closes = candles
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map((candle) => candle[4])
      .filter((close) => Number.isFinite(close) && close > 0);
    return closes.length >= 2 ? closes : "none";
  } catch {
    return null;
  }
}

/**
 * Closes over `period` per token address (oldest first; hourly for the
 * default 24h), resolved through each token's most-liquid pool from
 * lib/basePrices.ts. With `cachedOnly`, never spends budget — used for search
 * results, which would otherwise burn the whole budget on one keystroke.
 * Missing = no history. `retryAfterMs` is set when `retry` is non-empty
 * because the budget is spent: when the next slot frees up. Null otherwise
 * (upstream failure), and the caller falls back to its own backoff.
 */
export async function getTokenHistories(
  addresses: string[],
  cachedOnly = false,
  period: HistoryPeriod = "24h",
): Promise<{ history: Record<string, number[]>; retry: string[]; retryAfterMs: number | null }> {
  const normalized = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const out: Record<string, number[]> = {};
  // Not served and not known to be empty — the caller should ask again shortly.
  const retry: string[] = [];
  const now = Date.now();
  const stale: string[] = [];
  const keyOf = (address: string) => `${period}:${address}`;
  for (const address of normalized) {
    const cached = historyCache.get(keyOf(address));
    if (cached) out[address] = cached.closes;
    if (!cached || now - cached.at >= HISTORY_PERIODS[period].ttlMs) stale.push(address);
  }
  if (cachedOnly || stale.length === 0) return { history: out, retry, retryAfterMs: null };

  const metas = await getTokenMetas(stale);
  await Promise.all(
    stale.map((address) => {
      const pairAddress = metas.get(address)?.pairAddress;
      if (!pairAddress) return Promise.resolve();
      return dedupeInFlight(`history:${keyOf(address)}`, async () => {
        const closes = await fetchHistory(pairAddress, period);
        if (Array.isArray(closes)) historyCache.set(keyOf(address), { at: Date.now(), closes });
        return closes;
      }).then((closes) => {
        const cached = historyCache.get(keyOf(address));
        if (cached) out[address] = cached.closes;
        else if (closes === null) retry.push(address);
      });
    }),
  );
  const freesIn = retry.length > 0 ? budgetFreesIn() : 0;
  return { history: out, retry, retryAfterMs: freesIn > 0 ? freesIn : null };
}

async function fetchPoolList(list: "trending" | "new"): Promise<PoolList | null> {
  if (!takeBudget()) return null;
  const path = list === "trending" ? "trending_pools" : "new_pools";
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/base/${path}?include=base_token&page=1`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { relationships?: { base_token?: { data?: { id?: string } } } }[];
      included?: { attributes?: { address?: string; image_url?: string | null } }[];
    };
    // Rate-limit errors arrive as HTTP 200 with no `data` — don't cache that as "nothing trending".
    if (!Array.isArray(data.data) || data.data.length === 0) return null;
    // GeckoTerminal's logo, used only when DexScreener has none ("missing.png" = no logo).
    const images = new Map<string, string>();
    for (const token of data.included ?? []) {
      const address = token.attributes?.address?.toLowerCase();
      const image = token.attributes?.image_url;
      if (address && image && image.startsWith("https://") && !image.includes("missing")) images.set(address, image);
    }
    const addresses: string[] = [];
    for (const pool of data.data ?? []) {
      const id = pool.relationships?.base_token?.data?.id ?? "";
      const address = id.replace(/^base_/, "").toLowerCase();
      if (!address.startsWith("0x") || NOT_TRADEABLE.has(address) || addresses.includes(address)) continue;
      addresses.push(address);
    }
    return { addresses, images };
  } catch {
    return null;
  }
}

async function getPoolList(list: "trending" | "new"): Promise<PoolList | null> {
  const cached = listCache.get(list);
  if (!cached || Date.now() - cached.at >= TRENDING_TTL_MS) {
    const fresh = await dedupeInFlight(`list:${list}`, () => fetchPoolList(list));
    if (fresh) listCache.set(list, { at: Date.now(), ...fresh });
  }
  return listCache.get(list) ?? null;
}

/**
 * Trending Base coins (GeckoTerminal's trending pools, majors/stables
 * filtered out), priced and decorated through lib/basePrices.ts so a
 * trending row carries the same price/logo a search result would.
 */
export async function getTrendingTokens(): Promise<TokenSearchResult[]> {
  const trending = await getPoolList("trending");
  const summaries = await getTokenSummaries((trending?.addresses ?? []).slice(0, TRENDING_LIMIT + 4));
  return summaries
    .slice(0, TRENDING_LIMIT)
    .map((token) => ({ ...token, imageUrl: token.imageUrl ?? trending?.images.get(token.address) ?? null }));
}

/** Newly created Base pools with at least NEW_MIN_LIQUIDITY_USD of depth, newest first. */
export async function getNewTokens(): Promise<TokenSearchResult[]> {
  const fresh = await getPoolList("new");
  const summaries = await getTokenSummaries((fresh?.addresses ?? []).slice(0, 30));
  return summaries
    .filter((token) => token.liquidityUsd >= NEW_MIN_LIQUIDITY_USD)
    .sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0))
    .map((token) => ({ ...token, imageUrl: token.imageUrl ?? fresh?.images.get(token.address) ?? null }));
}
