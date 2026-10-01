// GeckoTerminal wrapper for the two things DexScreener's public API lacks:
// hourly price history (sparklines/charts) and a trending-on-Base list. Free,
// key-less, but only ~30 req/min shared across this whole server — so every
// call goes through a rolling per-minute budget kept well under that, and
// results are cached for minutes, not seconds. Over budget or on failure we
// serve the last cached value (or nothing): history is decoration, never a
// reason to fail a request. Prices/trading stay on lib/basePrices.ts.

import { getTokenMetas, getTokenSummaries, type TokenSearchResult } from "@/lib/basePrices";

const HISTORY_TTL_MS = 5 * 60_000;
const TRENDING_TTL_MS = 3 * 60_000;
const BUDGET_PER_MIN = 20;
const HISTORY_POINTS = 24; // hourly candles → a 24h line
const TRENDING_LIMIT = 10;

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

const historyCache = new Map<string, { at: number; closes: number[] }>();
type Trending = { addresses: string[]; images: Map<string, string> };
let trendingCache: ({ at: number } & Trending) | null = null;
const inFlight = new Map<string, Promise<unknown>>();
let budgetWindow: number[] = [];

function takeBudget() {
  const now = Date.now();
  budgetWindow = budgetWindow.filter((at) => now - at < 60_000);
  if (budgetWindow.length >= BUDGET_PER_MIN) return false;
  budgetWindow.push(now);
  return true;
}

function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function fetchHistory(pairAddress: string): Promise<number[] | null> {
  if (!takeBudget()) return null;
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${pairAddress}/ohlcv/hour?aggregate=1&limit=${HISTORY_POINTS}&currency=usd&token=base`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const candles = data.data?.attributes?.ohlcv_list ?? [];
    // Newest-first [ts, open, high, low, close, volume] → oldest-first closes.
    const closes = candles
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map((candle) => candle[4])
      .filter((close) => Number.isFinite(close) && close > 0);
    return closes.length >= 2 ? closes : null;
  } catch {
    return null;
  }
}

/**
 * Hourly closes for the last ~24h per token address (oldest first), resolved
 * through each token's most-liquid pool from lib/basePrices.ts. With
 * `cachedOnly`, never spends budget — used for search results, which would
 * otherwise burn the whole budget on one keystroke. Missing = no history.
 */
export async function getTokenHistories(addresses: string[], cachedOnly = false): Promise<Record<string, number[]>> {
  const normalized = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const out: Record<string, number[]> = {};
  const now = Date.now();
  const stale: string[] = [];
  for (const address of normalized) {
    const cached = historyCache.get(address);
    if (cached) out[address] = cached.closes;
    if (!cached || now - cached.at >= HISTORY_TTL_MS) stale.push(address);
  }
  if (cachedOnly || stale.length === 0) return out;

  const metas = await getTokenMetas(stale);
  await Promise.all(
    stale.map((address) => {
      const pairAddress = metas.get(address)?.pairAddress;
      if (!pairAddress) return Promise.resolve();
      return dedupeInFlight(`history:${address}`, async () => {
        const closes = await fetchHistory(pairAddress);
        if (closes) historyCache.set(address, { at: Date.now(), closes });
      }).then(() => {
        const cached = historyCache.get(address);
        if (cached) out[address] = cached.closes;
      });
    }),
  );
  return out;
}

async function fetchTrending(): Promise<Trending | null> {
  if (!takeBudget()) return null;
  try {
    const res = await fetch("https://api.geckoterminal.com/api/v2/networks/base/trending_pools?include=base_token&page=1", {
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

/**
 * Trending Base coins (GeckoTerminal's trending pools, majors/stables
 * filtered out), priced and decorated through lib/basePrices.ts so a
 * trending chip carries the same price/logo a search result would.
 */
export async function getTrendingTokens(): Promise<TokenSearchResult[]> {
  if (!trendingCache || Date.now() - trendingCache.at >= TRENDING_TTL_MS) {
    const trending = await dedupeInFlight("trending", fetchTrending);
    if (trending) trendingCache = { at: Date.now(), ...trending };
  }
  const summaries = await getTokenSummaries((trendingCache?.addresses ?? []).slice(0, TRENDING_LIMIT + 4));
  return summaries
    .slice(0, TRENDING_LIMIT)
    .map((token) => ({ ...token, imageUrl: token.imageUrl ?? trendingCache?.images.get(token.address) ?? null }));
}
