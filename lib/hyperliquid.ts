// Hyperliquid's public info API (no key, no auth), for the markets Coinbase
// doesn't list — the xyz:NVDA stock perp trades 24/7 there. Every helper
// returns null on failure and never throws, same invariant as getSpotPrice().

const INFO_URL = "https://api.hyperliquid.xyz/info";

type Level = { px: string; sz: string; n: number };
type HlTrade = { px: string; time: number };
type HlCandle = { t: number; T: number; o: string; c: string; h: string; l: string };

async function info<T>(body: unknown): Promise<T | null> {
  try {
    const res = await fetch(INFO_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "User-Agent": "btc-arena" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Recent trades, oldest first; null on failure. */
export async function hlTrades(coin: string): Promise<{ t: number; p: number }[] | null> {
  const body = await info<HlTrade[]>({ type: "recentTrades", coin });
  if (!Array.isArray(body)) return null;
  const trades = body
    .map((trade) => ({ t: trade.time, p: positive(trade.px) ?? NaN }))
    .filter((trade) => Number.isFinite(trade.t) && Number.isFinite(trade.p));
  return trades.length > 0 ? trades.sort((a, b) => a.t - b.t) : null;
}

/** Last trade plus best bid/ask: the same shape /api/ticker serves for Coinbase. */
export async function hlTicker(coin: string): Promise<{ price: number; bid: number | null; ask: number | null } | null> {
  const [book, trades] = await Promise.all([
    info<{ levels: [Level[], Level[]] }>({ type: "l2Book", coin }),
    hlTrades(coin),
  ]);
  const bid = positive(book?.levels?.[0]?.[0]?.px);
  const ask = positive(book?.levels?.[1]?.[0]?.px);
  const mid = bid && ask && ask >= bid ? (bid + ask) / 2 : null;
  const price = trades?.at(-1)?.p ?? mid;
  return price ? { price, bid, ask } : null;
}

/** Candles in [start, end] at `interval` ("1m", "15m", …), oldest first; null on failure. */
export async function hlCandles(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<{ t: number; open: number; close: number; high: number; low: number }[] | null> {
  const body = await info<HlCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } });
  if (!Array.isArray(body)) return null;
  return body
    .map((c) => ({ t: c.t, open: Number(c.o), close: Number(c.c), high: Number(c.h), low: Number(c.l) }))
    .filter((c) => [c.open, c.close, c.high, c.low].every((v) => Number.isFinite(v) && v > 0))
    .sort((a, b) => a.t - b.t);
}

const DAY_MS = 86_400_000;
const DAY_FRESH_MS = 30_000;
const dayCache = new Map<string, { at: number; day: Promise<DayStats | null> }>();
export type DayStats = { open: number; high: number; low: number; last: number };

/** Rolling 24h open/high/low/last off 15-minute candles, cached 30s per coin. */
export function hlDayStats(coin: string): Promise<DayStats | null> {
  const hit = dayCache.get(coin);
  if (hit && Date.now() - hit.at < DAY_FRESH_MS) return hit.day;
  const now = Date.now();
  const day = hlCandles(coin, "15m", now - DAY_MS, now).then((candles) => {
    if (!candles || candles.length === 0) return null;
    return {
      open: candles[0].open,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      last: candles[candles.length - 1].close,
    };
  });
  dayCache.set(coin, { at: now, day });
  return day;
}
