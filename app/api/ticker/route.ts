export const dynamic = "force-dynamic";

const SUPPORTED_PRODUCTS = new Set(["BTC-USD", "ETH-USD", "DOGE-USD"]);

/**
 * REST fallback for the live feed (app/usePriceFeed.ts): last trade plus best
 * bid/ask from Coinbase Exchange, the same numbers the websocket ticker carries.
 * The hook polls this only while the socket is silent, so the chart keeps
 * moving when a network blocks or drops the websocket.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("symbol") ?? "BTC-USD";
  if (!SUPPORTED_PRODUCTS.has(product)) {
    return Response.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, {
      cache: "no-store",
      headers: { "User-Agent": "btc-arena" },
    });
    if (!res.ok) throw new Error();
    const body = (await res.json()) as { price?: string; bid?: string; ask?: string };
    const price = Number(body.price);
    const bid = Number(body.bid);
    const ask = Number(body.ask);
    if (!(price > 0)) throw new Error();
    return Response.json(
      { price, bid: bid > 0 ? bid : null, ask: ask > 0 ? ask : null, at: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: `Could not fetch ${product} ticker` }, { status: 502 });
  }
}
