import { hlCandles, hlTrades } from "@/lib/hyperliquid";
import { HYPERLIQUID_COINS, SUPPORTED_PRODUCTS } from "@/lib/spotPrice";
import { MAX_WINDOW_MS, SAMPLE_MS, WINDOW_MS } from "../../feedConfig";

export const dynamic = "force-dynamic";

type Trade = { time: string; price: string };

// [ time, low, high, open, close, volume ], newest first
type Candle = [number, number, number, number, number, number];

type Point = { t: number; p: number };

const HEADERS = { "User-Agent": "btc-arena" };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * SAMPLE_MS buckets: newest trade time per bucket, but the mean price — trades
 * bounce between bid and ask, and the mean lands near the midpoint the socket plots.
 */
function bucketTrades(trades: Point[], cutoff: number): Point[] {
  const buckets = new Map<number, { t: number; sum: number; n: number }>();
  for (const { t, p } of trades) {
    if (t < cutoff) continue;
    const bucket = Math.floor(t / SAMPLE_MS);
    const existing = buckets.get(bucket);
    if (!existing) buckets.set(bucket, { t, sum: p, n: 1 });
    else {
      existing.t = Math.max(existing.t, t);
      existing.sum += p;
      existing.n += 1;
    }
  }
  return [...buckets.values()].map(({ t, sum, n }) => ({ t, p: sum / n })).sort((a, b) => a.t - b.t);
}

/** Hyperliquid's trades + 1m candles, shaped like the Coinbase pair below. */
async function fromHyperliquid(coin: string, cutoff: number, now: number): Promise<{ trades: Point[]; candles: Point[] }> {
  const from = Math.floor(cutoff / 60_000) * 60_000 - 60_000;
  const [trades, candles] = await Promise.all([hlTrades(coin), hlCandles(coin, "1m", from, now)]);
  const points = (candles ?? []).flatMap((c) => [
    { t: c.t, p: c.open },
    { t: Math.min(c.t + 59_999, now), p: c.close },
  ]);
  const first = points.findIndex((point) => point.t >= cutoff);
  return {
    trades: bucketTrades(trades ?? [], cutoff),
    candles: first === -1 ? points.slice(-1) : points.slice(Math.max(0, first - 1)),
  };
}

/**
 * Seeds the chart at the same resolution the live socket produces, by bucketing
 * recent trades into SAMPLE_MS slots. ~1000 trades is usually a few minutes, but
 * on a busy tape it can be well under one — hence the candle backfill below.
 */
async function fromTrades(product: string, cutoff: number): Promise<Point[]> {
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${product}/trades?limit=1000`,
    { cache: "no-store", headers: HEADERS },
  );
  if (!res.ok) throw new Error("trades unavailable");

  const trades = ((await res.json()) as Trade[])
    .map((trade) => ({ t: Date.parse(trade.time), p: Number(trade.price) }))
    .filter(({ t, p }) => Number.isFinite(t) && Number.isFinite(p) && p > 0);
  return bucketTrades(trades, cutoff);
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
async function fromCandles(product: string, cutoff: number, now: number): Promise<Point[]> {
  // Coinbase only returns candles that start at or after `start`, so ask from a
  // minute before the one holding the cutoff: its points straddle the left edge.
  const from = Math.floor(cutoff / 60_000) * 60_000 - 60_000;
  const range = `start=${new Date(from).toISOString()}&end=${new Date(
    now,
  ).toISOString()}`;
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${product}/candles?granularity=60&${range}`,
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

  const sorted = points
    .filter((point) => Number.isFinite(point.p) && point.p > 0 && point.t <= now)
    .sort((a, b) => a.t - b.t);
  // Everything inside the window, plus the newest point before it to
  // interpolate the left edge from.
  const first = sorted.findIndex((point) => point.t >= cutoff);
  return first === -1 ? sorted.slice(-1) : sorted.slice(Math.max(0, first - 1));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = searchParams.get("symbol") ?? "BTC-USD";
  if (!SUPPORTED_PRODUCTS.has(product)) {
    return Response.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  // Optional longer window (the Arena lobby's LOBBY_WINDOW_MS), clamped so a
  // caller can't ask for an unbounded candle range.
  const asked = Number(searchParams.get("windowMs"));
  const windowMs = Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, WINDOW_MS), MAX_WINDOW_MS) : WINDOW_MS;

  const now = Date.now();
  // One sample of slack past the window, matching the hook: the chart needs a
  // point just outside the left edge to interpolate the crossing from.
  const cutoff = now - windowMs - SAMPLE_MS;

  // Both sources, always: the chart draws a fixed-width window, so a seed that
  // only covers the last 40 seconds would leave most of the axis empty. 1000
  // trades is ~5min of a quiet tape but under a minute of a busy one.
  const hlCoin = HYPERLIQUID_COINS[product];
  const { trades, candles } = hlCoin
    ? await fromHyperliquid(hlCoin, cutoff, now)
    : await Promise.all([
        fromTrades(product, cutoff).catch(() => [] as Point[]),
        fromCandles(product, cutoff, now).catch(() => [] as Point[]),
      ]).then(([trades, candles]) => ({ trades, candles }));

  // Trades win wherever they exist; candles only fill the stretch before them.
  const oldestTrade = trades.length > 0 ? trades[0].t : Infinity;
  const points = [
    ...candles.filter((point) => point.t < oldestTrade),
    ...trades,
  ];

  // The chart fills itself from the live socket, so an empty seed is survivable.
  return Response.json({ points }, { headers: NO_STORE });
}
