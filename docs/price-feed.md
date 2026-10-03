# price-feed

`app/usePriceFeed.ts` + 2 API routes. Hook returns `{ price, points, status, now, day, getLivePrice }`.

## Sources

| Source | Role | Ref |
| --- | --- | --- |
| `wss://ws-feed.exchange.coinbase.com` `ticker` + `heartbeat` | live price; heartbeat = liveness | `app/usePriceFeed.ts:11`, sub at `:140` |
| `/api/history` | seed chart on load, full window | `app/api/history/route.ts` |
| `/api/ticker` | REST fallback: polled every `POLL_MS`=2s while socket silent > `POLL_AFTER_MS`=2.5s; trade + bid/ask | `app/api/ticker/route.ts` |
| `/api/price` | settle when socket stale/dead | `app/api/price/route.ts` |

No API key on any path.

## Sampling

- `ticker` fires **only on a trade**. Measured over 60s: BTC max gap 1.1s, ETH 17s, DOGE 43s. `heartbeat` fires 1/s per product regardless. Any message stamps `heardAtRef` (liveness).
- `price` = last trade, updates every tick; `getLivePrice` stays on it (settlement).
- Series + live edge plot the bid/ask midpoint (`best_bid`/`best_ask`), falling back to trade price. Trades alternate bid/ask, so trade price zigzags 1 tick on a quiet tape with nothing moving.
- `day` = `{ open, high, low }` from the ticker's `open_24h`/`high_24h`/`low_24h`; `null` until first tick.
- Plotted series commits 1 point per `SAMPLE_MS`=1s **on the clock**, carrying the last midpoint forward, while `heardAtRef` < `FRESH_MS` old (`app/usePriceFeed.ts:65-76`). Was trade-driven: a 17s+ trade gap froze the line, and >30s emptied the lobby window → placeholder. Raw ticks would render as flat noise band. 1s is set by the chart's zoom floor, not by the default view: at `MIN_WINDOW_MS`=30s a 5s cadence gave 6 points across 880px — a hexagon, not a curve.
- `WINDOW_MS`=1min → ~60 points held. Trim on each commit via `trim()` (`app/usePriceFeed.ts:13-20`).
- `trim()` cuts at `WINDOW_MS + SAMPLE_MS`, one sample of slack: the chart interpolates its left-edge crossing from the point just outside the window (`docs/chart.md` → Time window).
- `trim()` cuts relative to `min(now, newest point)`, so a dead feed keeps its last window (chart shows it frozen, `is-stale`) instead of emptying.
- Per-product `seriesCache` (module-level): series state is tagged `{ product, points }`; a market switch starts from the cached series, then `mergeSeed` adds only seed points outside the live range.
- Returned `status` is `"live"` whenever any message (socket or REST) arrived < `FRESH_MS` ago, regardless of socket state.
- Live edge: synthetic `{ t: now, p: mid }` appended to `points` every clock tick while live (`app/usePriceFeed.ts:235-244`); dropped when no message for `FRESH_MS`, so a dead feed's line stops where its data stops.

## Seeding

The chart draws a fixed-width window from the first frame, so the seed has to fill
it — a seed covering only the last 40s would leave most of the axis empty.

- **Both** sources are fetched in parallel, always (`app/api/history/route.ts:96-100`). Neither alone is reliable for a full window.
- Trades: up to 1000 recent from `api.exchange.coinbase.com`, bucketed to `SAMPLE_MS`: newest trade time, **mean** trade price per bucket (approximates the midpoint the socket plots) (`app/api/history/route.ts:15-55`). ~5min of a quiet tape, under a minute of a busy one. The 1s bucket keeps more of them: measured 115 points over a 177s window, median gap 1.1s.
- Candles: 1-min, `granularity=60`, each emitting open@bucket-start + close@bucket-end (`app/api/history/route.ts:44-86`). Coarse, but reaches back as far as needed.
- `start`/`end` are **required** on the candles call (`:54-61`). Without an explicit range Coinbase answers with candles trailing ~3min behind now — exactly the stretch the backfill exists to cover. Measured: no range → newest bucket 190s old; with range → 30s old.
- The open bucket's close is the running price, so it is dated `now`, not at a bucket end that hasn't happened yet (`app/api/history/route.ts:68-74`).
- Merge: trades win wherever they exist, candles only fill the stretch *before* the oldest trade (`app/api/history/route.ts:102-107`).
- Both fail → `{ points: [] }`, HTTP 200 (`app/api/history/route.ts:109-110`) — socket refills in seconds, no error surfaced.
- Cutoff is `WINDOW_MS + SAMPLE_MS`, matching `trim()` — the chart needs one point outside the left edge to interpolate the crossing from (`app/api/history/route.ts:89-92`).
- Client merges seed + trims; `lastSampleAtRef` set to seed's newest ts so live feed continues seed cadence (`app/usePriceFeed.ts:58-66`).

## Freshness / settlement guard

- `getLivePrice()` returns last trade only if the socket was heard from (ticker **or heartbeat**) < `FRESH_MS`=5s ago, else `null` (`app/usePriceFeed.ts:58-62`). Was last-*trade* age, which nulled the price on any quiet tape.
- `/api/price`: Coinbase spot → Binance fallback, each validated finite+positive before accept (`lib/spotPrice.ts:39-52`). Both fail → 502 (`app/api/price/route.ts:17`). The same chain settles a match (`lib/match.ts:72`).

## Reconnection

- `connect()`: `onerror`+`onclose` both → `retry()`; `retried` flag dedupes double-fire, stale sockets ignored (`app/usePriceFeed.ts:189-196`).
- Watchdog: socket OPEN but silent > `STALL_MS`=8s (half-dead after sleep/network swap) → force close → retry (`app/usePriceFeed.ts:120-124`).
- Tab becomes visible with a stale/closed socket → immediate reconnect, backoff reset (`app/usePriceFeed.ts:205-216`).
- Backoff: `min(15000, 500 * 2^attempt)` → 500,1000,2000,4000,8000,capped 15000ms. `attempt` resets on open (`app/usePriceFeed.ts:86`).
- Cleanup nulls handlers before close to prevent reconnect-on-teardown (`app/usePriceFeed.ts:134-142`).

## Clock

- `now` state, `setInterval` every `CLOCK_MS`=100ms (`app/usePriceFeed.ts:11`, `:48-51`) → ~0.5px of chart travel per tick at the default window, ~3px at the 30s zoom floor. 250ms was smooth at 3min but stepped in visible 7px jumps once zoomed in.
- Exists because the chart's window ends at *now*, not at the last point: without it a silent socket freezes the axis instead of scrolling past the last sample.
- `useState(() => Date.now())` initialiser runs on the server too, but the server render has no points and hits the chart's placeholder, so there is no hydration mismatch.

## Status values

`"connecting" | "live" | "reconnecting"` → dot color in UI (`app/duel/[market]/pulse/[matchId]/page.tsx:200`).
