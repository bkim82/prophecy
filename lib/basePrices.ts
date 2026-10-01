// DexScreener wrapper for Base-chain meme coin search and pricing — the
// portfolio game's equivalent of lib/spotPrice.ts, but for an open-ended
// token universe instead of two fixed products. Free, key-less public REST,
// ~60 req/min shared across everyone hitting DexScreener from this server.
//
// Rate-limit math: a 4s shared price cache means a given address is fetched
// at most once per 4s regardless of how many users are viewing it, and
// batching up to 30 addresses per request means even ~120 simultaneously-hot
// addresses costs ~4 requests / 4s ≈ 1 req/s — far under the 60/min budget.
// Never throw to the caller: on total failure, serve stale cached data (or
// an empty result) rather than a 500, same invariant as getSpotPrice().
//
// Every pair DexScreener returns also carries display metadata (logo, 24h
// change, market cap, pool address). Each search/price fetch refreshes a
// per-address meta cache for free; getTokenMetas() only spends a request on
// addresses that cache has never seen (or saw > META_TTL_MS ago).

const SEARCH_TTL_MS = 10_000;
const PRICE_TTL_MS = 4_000;
const META_TTL_MS = 10 * 60_000;
const BATCH_SIZE = 30;
const CHAIN_ID = "base";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type TokenSearchResult = {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  imageUrl: string | null; // DexScreener-hosted logo; null when the token has no claimed profile
  change24h: number | null; // percent
  marketCapUsd: number | null;
  pairAddress: string | null; // most-liquid pool, used for price history (lib/tokenHistory.ts)
};

export type TokenMeta = Omit<TokenSearchResult, "priceUsd"> & { at: number };

export type TokenPrice = {
  address: string;
  priceUsd: number;
  stale: boolean;
};

type DexPair = {
  chainId: string;
  pairAddress?: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
};

const searchCache = new Map<string, { at: number; results: TokenSearchResult[] }>();
const priceCache = new Map<string, { at: number; price: number }>();
const metaCache = new Map<string, TokenMeta>();
const inFlight = new Map<string, Promise<unknown>>();

function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export const isTokenAddress = (value: string) => ADDRESS_RE.test(value.trim());

function pairToResult(pair: DexPair, priceUsd: number): TokenSearchResult {
  const change = pair.priceChange?.h24;
  const marketCap = pair.marketCap ?? pair.fdv;
  return {
    address: pair.baseToken.address.toLowerCase(),
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    priceUsd,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    imageUrl: pair.info?.imageUrl ?? null,
    change24h: typeof change === "number" && Number.isFinite(change) ? change : null,
    marketCapUsd: typeof marketCap === "number" && marketCap > 0 ? marketCap : null,
    pairAddress: pair.pairAddress ?? null,
  };
}

function rememberMeta(result: TokenSearchResult) {
  const { priceUsd: _price, ...meta } = result;
  const previous = metaCache.get(result.address);
  metaCache.set(result.address, {
    ...meta,
    // Keep a previously-seen logo if this pair's profile lacks one.
    imageUrl: meta.imageUrl ?? previous?.imageUrl ?? null,
    at: Date.now(),
  });
}

function pairsToSearchResults(pairs: DexPair[]): TokenSearchResult[] {
  const byAddress = new Map<string, TokenSearchResult>();
  for (const pair of pairs) {
    if (pair.chainId !== CHAIN_ID) continue;
    const address = pair.baseToken.address.toLowerCase();
    const priceUsd = Number(pair.priceUsd ?? 0);
    const liquidityUsd = pair.liquidity?.usd ?? 0;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const existing = byAddress.get(address);
    if (existing && existing.liquidityUsd >= liquidityUsd) continue;
    byAddress.set(address, pairToResult(pair, priceUsd));
  }
  const results = Array.from(byAddress.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  results.forEach(rememberMeta);
  return results;
}

/** Base-only token search by name, ticker or contract address, cached ~10s per normalized query. Never throws. */
export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  if (isTokenAddress(key)) return getTokenSummaries([key]);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results;

  return dedupeInFlight(`search:${key}`, async () => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      if (!res.ok) return cached?.results ?? [];
      const data = (await res.json()) as { pairs?: DexPair[] };
      const results = pairsToSearchResults(data.pairs ?? []).slice(0, 20);
      searchCache.set(key, { at: Date.now(), results });
      return results;
    } catch {
      return cached?.results ?? [];
    }
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchPriceChunk(addresses: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/${CHAIN_ID}/${addresses.join(",")}`, {
      cache: "no-store",
    });
    if (!res.ok) return prices;
    const data = (await res.json()) as DexPair[];
    for (const pair of data) {
      if (pair.chainId !== CHAIN_ID) continue;
      const address = pair.baseToken.address.toLowerCase();
      const priceUsd = Number(pair.priceUsd ?? 0);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
      if (!prices.has(address)) {
        prices.set(address, priceUsd);
        rememberMeta(pairToResult(pair, priceUsd));
      }
    }
  } catch {
    // fall through with whatever was resolved before the failure
  }
  return prices;
}

/**
 * Batch price lookup for a set of Base token addresses. Cached ~4s per
 * address; concurrent requests for the same uncached address share one
 * fetch. On failure for an address, serves its last-known cached price
 * (`stale: true`) rather than dropping it from the result.
 */
export async function getTokenPrices(addresses: string[]): Promise<TokenPrice[]> {
  const normalized = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const now = Date.now();
  const misses = normalized.filter((address) => {
    const cached = priceCache.get(address);
    return !cached || now - cached.at >= PRICE_TTL_MS;
  });

  if (misses.length > 0) {
    await Promise.all(
      chunk(misses, BATCH_SIZE).map((batch) =>
        dedupeInFlight(`price:${batch.join(",")}`, async () => {
          const resolved = await fetchPriceChunk(batch);
          for (const [address, priceUsd] of resolved) {
            priceCache.set(address, { at: Date.now(), price: priceUsd });
          }
        }),
      ),
    );
  }

  return normalized.map((address) => {
    const cached = priceCache.get(address);
    return {
      address,
      priceUsd: cached?.price ?? 0,
      stale: !cached || now - cached.at >= PRICE_TTL_MS,
    };
  });
}

/**
 * Display metadata (logo, 24h change, market cap, pool) per address. Only
 * addresses missing from the meta cache, or older than ~10 min, cost a
 * DexScreener request — for rows that don't need a live price, like closed
 * positions. Never throws; unknown addresses are simply absent.
 */
export async function getTokenMetas(addresses: string[]): Promise<Map<string, TokenMeta>> {
  const normalized = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const now = Date.now();
  const misses = normalized.filter((address) => {
    const cached = metaCache.get(address);
    return !cached || now - cached.at >= META_TTL_MS;
  });
  if (misses.length > 0) await getTokenPrices(misses);

  const out = new Map<string, TokenMeta>();
  for (const address of normalized) {
    const meta = metaCache.get(address);
    if (meta) out.set(address, meta);
  }
  return out;
}

/** Live price + metadata per address, in input order, dropping any address with no live price. */
export async function getTokenSummaries(addresses: string[]): Promise<TokenSearchResult[]> {
  const prices = await getTokenPrices(addresses);
  const out: TokenSearchResult[] = [];
  for (const price of prices) {
    const meta = metaCache.get(price.address);
    if (!meta || price.priceUsd <= 0) continue;
    const { at: _at, ...rest } = meta;
    out.push({ ...rest, priceUsd: price.priceUsd });
  }
  return out;
}
