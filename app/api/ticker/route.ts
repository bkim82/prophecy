import { hlDayStats, hlTicker } from "@/lib/hyperliquid";
import { HYPERLIQUID_COINS, SUPPORTED_PRODUCTS } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

/**
 * REST fallback for the live feed (app/usePriceFeed.ts): last trade plus best
 * bid/ask from Coinbase Exchange, the same numbers the websocket ticker carries.
 * The hook polls this only while the socket is silent, so the chart keeps
 * moving when a network blocks or drops the websocket.
 *
 * Hyperliquid products (HYPERLIQUID_COINS) also carry rolling 24h `day`
 * figures, since their socket has none; the hook polls for those separately.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("symbol") ?? "BTC-USD";
  if (!SUPPORTED_PRODUCTS.has(product)) {
    return Response.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  const hlCoin = HYPERLIQUID_COINS[product];
  if (hlCoin) {
    const [ticker, day] = await Promise.all([hlTicker(hlCoin), hlDayStats(hlCoin)]);
    if (!ticker) return Response.json({ error: `Could not fetch ${product} ticker` }, { status: 502 });
    return Response.json({ ...ticker, day, at: Date.now() }, { headers: { "Cache-Control": "no-store" } });
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
