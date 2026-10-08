// One source of truth for "how do we get a settlement price": used by the
// public /api/price proxy and by server-side match settlement (lib/match.ts).

export const SUPPORTED_PRODUCTS = new Set(["BTC-USD", "ETH-USD"]);

const PRODUCT_BY_MARKET: Record<string, string> = {
  btc: "BTC-USD",
  eth: "ETH-USD",
};

/** "btc" → "BTC-USD". Returns null for a market we don't price. */
export const productForMarket = (market: string): string | null =>
  PRODUCT_BY_MARKET[market] ?? null;

type Source = {
  name: string;
  url: string;
  parse: (data: unknown) => number;
};

// Free, key-less sources per product; later ones cover earlier ones being
// rate-limited. The exchange ticker comes first: it is the same tape the
// client's websocket plots, ~1s fresh. The consumer `v2/.../spot` endpoint is
// CDN-cached for ~10s, so pricing a Pulse entry off it filled at a price the
// chart had already left behind.
const sourcesFor = (product: string): Source[] => [
  {
    name: "coinbase-exchange",
    url: `https://api.exchange.coinbase.com/products/${product}/ticker`,
    parse: (data) => Number((data as { price: string }).price),
  },
  {
    name: "coinbase",
    url: `https://api.coinbase.com/v2/prices/${product}/spot`,
    parse: (data) => Number((data as { data: { amount: string } }).data.amount),
  },
  {
    name: "binance",
    url: `https://api.binance.com/api/v3/ticker/price?symbol=${product.replace("-", "")}T`,
    parse: (data) => Number((data as { price: string }).price),
  },
];

export type SpotPrice = { price: number; source: string; at: number };

/** Walks the fallback chain; null once every source has failed. Never throws. */
export async function getSpotPrice(product: string): Promise<SpotPrice | null> {
  for (const source of sourcesFor(product)) {
    try {
      const res = await fetch(source.url, {
        cache: "no-store",
        headers: { "User-Agent": "btc-arena" },
      });
      if (!res.ok) continue;
      const price = source.parse(await res.json());
      if (!Number.isFinite(price) || price <= 0) continue;
      return { price, source: source.name, at: Date.now() };
    } catch {
      // try the next source
    }
  }
  return null;
}

export type TapeTrade = { t: number; p: number };

/**
 * The last 100 Coinbase Exchange trades, oldest first; null on failure. One
 * spot sample per poll would miss a wick between polls that the client's
 * socket showed, so liquidation checks every trade instead. 100 trades spans
 * several seconds of BTC, comfortably more than the 1s poll gap.
 */
export async function getRecentTrades(product: string): Promise<TapeTrade[] | null> {
  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/trades?limit=100`, {
      cache: "no-store",
      headers: { "User-Agent": "btc-arena" },
    });
    if (!res.ok) return null;
    const trades = ((await res.json()) as { time: string; price: string }[])
      .map((trade) => ({ t: Date.parse(trade.time), p: Number(trade.price) }))
      .filter((trade) => Number.isFinite(trade.t) && Number.isFinite(trade.p) && trade.p > 0);
    return trades.length > 0 ? trades.sort((a, b) => a.t - b.t) : null;
  } catch {
    return null;
  }
}
