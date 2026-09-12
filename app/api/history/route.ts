import { SAMPLE_MS, WINDOW_MS } from "../../feedConfig";

export const dynamic = "force-dynamic";

type Trade = { time: string; price: string };

// [ time, low, high, open, close, volume ], newest first
type Candle = [number, number, number, number, number, number];

type Point = { t: number; p: number };

const HEADERS = { "User-Agent": "btc-duel" };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Seeds the chart at the same resolution the live socket produces, by bucketing
 * recent trades into SAMPLE_MS slots. ~1000 trades is usually a few minutes, but
 * on a busy tape it can be well under one — hence the candle backfill below.
 */
async function fromTrades(cutoff: number): Promise<Point[]> {
  const res = await fetch(
    "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000",
    { cache: "no-store", headers: HEADERS },
  );
  if (!res.ok) throw new Error("trades unavailable");

  const buckets = new Map<number, Point>();

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

  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

/**
 * One-minute candles: coarse, but they reach back as far as the window needs.
 * Each candle yields its open at the bucket start and its close at the bucket
 * end, so the backfilled stretch is anchored at both ends rather than drifting.
 *
 * start/end are required: without an explicit range Coinbase answers with
 * candles that trail ~3 minutes behind now, which is exactly the stretch the
 * backfill exists to cover.
 */
async function fromCandles(cutoff: number, now: number): Promise<Point[]> {
  const range = `start=${new Date(cutoff).toISOString()}&end=${new Date(
    now,
  ).toISOString()}`;
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&${range}`,
    { cache: "no-store", headers: HEADERS },
  );
  if (!res.ok) throw new Error("candles unavailable");

  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("candles malformed");

  const points: Point[] = [];
  for (const [time, , , open, close] of body as Candle[]) {
    const start = time * 1000;
    // The newest bucket is still open, so its close is the running price:
    // date it now rather than at a bucket end that hasn't happened yet.
    points.push(
      { t: start, p: open },
      { t: Math.min(start + 59_999, now), p: close },
    );
  }

  return points
    .filter(
      (point) =>
        Number.isFinite(point.p) &&
        point.p > 0 &&
        point.t >= cutoff &&
        point.t <= now,
    )
    .sort((a, b) => a.t - b.t);
}

export async function GET() {
  const now = Date.now();
  // One sample of slack past the window, matching the hook: the chart needs a
  // point just outside the left edge to interpolate the crossing from.
  const cutoff = now - WINDOW_MS - SAMPLE_MS;

  // Both sources, always: the chart draws a fixed-width window, so a seed that
  // only covers the last 40 seconds would leave most of the axis empty. 1000
  // trades is ~5min of a quiet tape but under a minute of a busy one.
  const [trades, candles] = await Promise.all([
    fromTrades(cutoff).catch(() => [] as Point[]),
    fromCandles(cutoff, now).catch(() => [] as Point[]),
  ]);

  // Trades win wherever they exist; candles only fill the stretch before them.
  const oldestTrade = trades.length > 0 ? trades[0].t : Infinity;
  const points = [
    ...candles.filter((point) => point.t < oldestTrade),
    ...trades,
  ];

  // The chart fills itself from the live socket, so an empty seed is survivable.
  return Response.json({ points }, { headers: NO_STORE });
}
