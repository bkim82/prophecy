import type { MarketDay, MarketStats } from "@/app/lib/arenaLobby";
import { hlDayStats } from "@/lib/hyperliquid";
import { HYPERLIQUID_COINS } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

// Rolling 24h open/high/low/last per Arena market, for the market switcher's
// % change on the markets that aren't streaming (app/duel/page.tsx). The
// selected market's numbers come off its live socket instead (usePriceFeed `day`).
const PRODUCTS = { btc: "BTC-USD", eth: "ETH-USD", nvda: "NVDA-USD" } as const;
const FRESH_MS = 30_000;

async function statsFor(product: string): Promise<MarketDay | null> {
  const hlCoin = HYPERLIQUID_COINS[product];
  if (hlCoin) return hlDayStats(hlCoin);
  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/stats`, {
      cache: "no-store",
      headers: { "User-Agent": "btc-arena" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, string>;
    const day = { open: Number(body.open), high: Number(body.high), low: Number(body.low), last: Number(body.last) };
    return Object.values(day).every((value) => Number.isFinite(value) && value > 0) ? day : null;
  } catch {
    return null;
  }
}

let cached: { at: number; stats: Promise<MarketStats> } | null = null;

/** GET → MarketStats; a market Coinbase couldn't answer for is left out. */
export async function GET() {
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    cached = {
      at: Date.now(),
      stats: Promise.all(
        Object.entries(PRODUCTS).map(async ([market, product]) => [market, await statsFor(product)] as const),
      ).then((entries) => Object.fromEntries(entries.filter(([, day]) => day !== null)) as MarketStats),
    };
  }
  return Response.json(await cached.stats, { headers: { "Cache-Control": "no-store" } });
}
