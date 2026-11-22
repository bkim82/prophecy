import type { MarketDay, MarketStats } from "@/app/lib/arenaLobby";
import { hlCandles, hlDayStats } from "@/lib/hyperliquid";
import { HYPERLIQUID_COINS } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

// Rolling 24h open/high/low/last per Arena market, for the market switcher's
// % change on the markets that aren't streaming (app/duel/page.tsx). The
// selected market's numbers come off its live socket instead (usePriceFeed `day`).
// Also each market's 6h realized volatility, for the lobby's volatility badge.
const PRODUCTS = { btc: "BTC-USD", eth: "ETH-USD", nvda: "NVDA-USD" } as const;
const FRESH_MS = 30_000;
const VOL_WINDOW_MS = 6 * 60 * 60 * 1000;
const VOL_CANDLE_MS = 5 * 60 * 1000;
// Fewer 5-minute returns than this (half the window) and the figure is noise.
const VOL_MIN_RETURNS = 36;

/** 5-minute closes over the last 6h, oldest first; null on failure. */
async function closesFor(product: string, now: number): Promise<number[] | null> {
  const from = now - VOL_WINDOW_MS;
  const hlCoin = HYPERLIQUID_COINS[product];
  if (hlCoin) return (await hlCandles(hlCoin, "5m", from, now))?.map((c) => c.close) ?? null;
  try {
    const range = `start=${new Date(from).toISOString()}&end=${new Date(now).toISOString()}`;
    const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=300&${range}`, {
      cache: "no-store",
      headers: { "User-Agent": "btc-arena" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body)) return null;
    // [ time, low, high, open, close, volume ], newest first
    return (body as number[][])
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[4]) && c[4] > 0)
      .sort((a, b) => a[0] - b[0])
      .map((c) => c[4]);
  } catch {
    return null;
  }
}

/**
 * Realized volatility over the 6h window in %: √(Σ r²) of the 5-minute log
 * returns, scaled up to a full window's worth of returns when candles are
 * missing (Coinbase skips minutes with no trades).
 */
async function vol6hFor(product: string): Promise<number | null> {
  const closes = await closesFor(product, Date.now());
  if (!closes || closes.length - 1 < VOL_MIN_RETURNS) return null;
  let sumSq = 0;
  for (let i = 1; i < closes.length; i++) sumSq += Math.log(closes[i] / closes[i - 1]) ** 2;
  const returns = closes.length - 1;
  const vol = Math.sqrt(sumSq * (VOL_WINDOW_MS / VOL_CANDLE_MS / returns)) * 100;
  return Number.isFinite(vol) ? vol : null;
}

async function statsFor(product: string): Promise<MarketDay | null> {
  const [day, vol6h] = await Promise.all([dayFor(product), vol6hFor(product)]);
  return day ? { ...day, vol6h } : null;
}

async function dayFor(product: string): Promise<Omit<MarketDay, "vol6h"> | null> {
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
