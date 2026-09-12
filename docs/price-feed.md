# Price feed

Everything price-related lives in `app/usePriceFeed.ts` plus the two API routes. The hook returns `{ price, points, status, getLivePrice }`.

## Three sources, three jobs

| Source | Used for | Where |
| --- | --- | --- |
| `wss://ws-feed.exchange.coinbase.com` ticker channel | Live price and the growing series | `app/usePriceFeed.ts:9`, subscribed at `:76-82` |
| `/api/history` | Seeding the chart so it is not empty on load | `app/api/history/route.ts` |
| `/api/price` | Settling a round when the socket is stale or dead | `app/api/price/route.ts` |

None of them need an API key.

## Sampling: why the plotted series is not every tick

BTC ticks many times per second. Plotted raw, the line becomes a dense flat band — the vertical noise saturates and the actual shape disappears. So the hook separates two things:

- **The headline price** updates on every single tick (`app/usePriceFeed.ts:100`).
- **The plotted series** commits one point per `SAMPLE_MS` = 5s (`app/usePriceFeed.ts:102-105`).

`WINDOW_MS` = 3 minutes, so the chart holds roughly 36 committed points. Older points are trimmed on every commit by `trim()` (`app/usePriceFeed.ts:12-16`), which finds the first point inside the cutoff and slices.

## The live edge

If the series only ever showed committed samples, the right-hand tip of the line would visibly lag by up to 5 seconds. The hook solves this in `points` (`app/usePriceFeed.ts:135-142`): it appends a synthetic "edge" point carrying the latest tick, unless the last committed sample is within 500ms. So the leading point tracks every tick while the rest of the line keeps its sampled shape.

## Seeding

`/api/history` pulls up to 1000 recent trades from `api.exchange.coinbase.com` and buckets them into `SAMPLE_MS` slots, keeping the newest trade per bucket so the result matches the socket's last-tick-wins behavior (`app/api/history/route.ts:17-42`).

If trades are unavailable or yield fewer than two points, it falls back to one-minute candles — coarser, but a working chart (`app/api/history/route.ts:45-57`). If both fail it returns `{ points: [] }` with a 200, because the socket refills the chart within seconds and an error here should not break the page (`app/api/history/route.ts:68-69`).

On the client, the seed is merged, sorted, and trimmed, and `lastSampleAtRef` is advanced to the seed's newest timestamp so the live feed continues the seed's cadence rather than committing a point immediately (`app/usePriceFeed.ts:46-54`).

## Freshness and settlement

`getLivePrice()` returns the last tick **only if it arrived within `FRESH_MS` = 5s** (`app/usePriceFeed.ts:35-39`). Otherwise it returns `null` and the caller falls back to REST. This is the guard that stops a round settling against a price frozen by a dead socket.

`/api/price` tries Coinbase spot, then Binance, validating that each parses to a finite positive number before accepting it (`app/api/price/route.ts:23-37`). Only if both fail does it return 502, which surfaces in the UI as a retry button.

## Reconnection

`connect()` wires both `onerror` and `onclose` to the same `retry()`. Because both fire on a dropped connection, a `retried` flag ensures only one reconnect is scheduled per socket (`app/usePriceFeed.ts:70`, `:108-117`).

Backoff is `min(15000, 500 * 2^attempt)` — 500ms, 1s, 2s, 4s, 8s, then capped at 15s. `attempt` resets to 0 on a successful open (`app/usePriceFeed.ts:74`).

Cleanup nulls the handlers before closing, so teardown does not trigger a reconnect (`app/usePriceFeed.ts:122-130`).

## Status

`status` is `"connecting" | "live" | "reconnecting"`, rendered as a coloured dot next to the price: a pulsing green dot when live, amber otherwise (`app/page.tsx:158-169`).
