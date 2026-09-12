import { SAMPLE_MS, WINDOW_MS } from "../../feedConfig";

export const dynamic = "force-dynamic";

type Trade = { time: string; price: string };

// [ time, low, high, open, close, volume ], newest first
type Candle = [number, number, number, number, number, number];

const HEADERS = { "User-Agent": "btc-duel" };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Seeds the chart at the same resolution the live socket produces, by bucketing
 * recent trades into SAMPLE_MS slots. ~1000 trades covers several minutes.
 */
async function fromTrades() {
  const res = await fetch(
    "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000",
    { cache: "no-store", headers: HEADERS },
  );
  if (!res.ok) throw new Error("trades unavailable");

  const cutoff = Date.now() - WINDOW_MS;
  const buckets = new Map<number, { t: number; p: number }>();

  for (const trade of (await res.json()) as Trade[]) {
    const t = Date.parse(trade.time);
    const p = Number(trade.price);
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
    if (t < cutoff) continue;

    const bucket = Math.floor(t / SAMPLE_MS);
    const existing = buckets.get(bucket);
    // Keep the newest trade in the bucket, matching the socket's last-tick-wins.
    if (!existing || t > existing.t) buckets.set(bucket, { t, p });
  }

  const points = [...buckets.values()].sort((a, b) => a.t - b.t);
  if (points.length < 2) throw new Error("not enough trades");
  return points;
}

// One-minute candles: coarser, but a working chart if trades are unavailable.
async function fromCandles() {
  const res = await fetch(
    "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60",
    { cache: "no-store", headers: HEADERS },
  );
  if (!res.ok) throw new Error("candles unavailable");

  return ((await res.json()) as Candle[])
    .slice(0, Math.ceil(WINDOW_MS / 60_000))
    .reverse()
    .map(([time, , , , close]) => ({ t: time * 1000, p: close }))
    .filter((point) => Number.isFinite(point.p) && point.p > 0);
}

export async function GET() {
  for (const source of [fromTrades, fromCandles]) {
    try {
      return Response.json({ points: await source() }, { headers: NO_STORE });
    } catch {
      // fall through to the next source
    }
  }

  // The chart fills itself from the live socket, so an empty seed is survivable.
  return Response.json({ points: [] }, { headers: NO_STORE });
}
