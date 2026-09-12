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

// Two free, key-less sources per product; the second covers the first being
// rate-limited.
const sourcesFor = (product: string): Source[] => [
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
      const res = await fetch(source.url, { cache: "no-store" });
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
