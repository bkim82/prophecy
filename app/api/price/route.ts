export const dynamic = "force-dynamic";

type Source = {
  name: string;
  url: string;
  parse: (data: unknown) => number;
};

const SUPPORTED_PRODUCTS = new Set(["BTC-USD", "ETH-USD"]);

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("symbol") ?? "BTC-USD";
  if (!SUPPORTED_PRODUCTS.has(product)) {
    return Response.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  for (const source of sourcesFor(product)) {
    try {
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) continue;
      const price = source.parse(await res.json());
      if (!Number.isFinite(price) || price <= 0) continue;
      return Response.json(
        { price, source: source.name, at: Date.now() },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      // try the next source
    }
  }

  return Response.json({ error: `Could not fetch ${product} price` }, { status: 502 });
}
