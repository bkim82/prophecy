export const dynamic = "force-dynamic";

type Source = {
  name: string;
  url: string;
  parse: (data: unknown) => number;
};

// Two free, key-less sources; the second covers the first being rate-limited.
const SOURCES: Source[] = [
  {
    name: "coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parse: (data) => Number((data as { data: { amount: string } }).data.amount),
  },
  {
    name: "binance",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    parse: (data) => Number((data as { price: string }).price),
  },
];

export async function GET() {
  for (const source of SOURCES) {
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

  return Response.json({ error: "Could not fetch BTC price" }, { status: 502 });
}
