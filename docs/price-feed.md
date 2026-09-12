# price-feed

`app/usePriceFeed.ts` + 2 API routes. Hook returns `{ price, points, status, getLivePrice }`.

## Sources

| Source | Role | Ref |
| --- | --- | --- |
| `wss://ws-feed.exchange.coinbase.com` ticker | live price + growing series | `app/usePriceFeed.ts:9`, sub at `:76-82` |
| `/api/history` | seed chart on load | `app/api/history/route.ts` |
| `/api/price` | settle when socket stale/dead | `app/api/price/route.ts` |

No API key on any path.

## Sampling

- Headline price updates every tick (`app/usePriceFeed.ts:100`).
- Plotted series commits 1 point per `SAMPLE_MS`=5s (`app/usePriceFeed.ts:102-105`). Raw ticks would render as flat noise band.
- `WINDOW_MS`=3min → ~36 points held. Trim on each commit via `trim()` (`app/usePriceFeed.ts:12-16`).
- Live edge: synthetic point appended in `points` carrying latest tick unless last sample <500ms old (`app/usePriceFeed.ts:135-142`) — avoids up-to-5s visible lag at line tip.

## Seeding

- `/api/history`: up to 1000 recent trades from `api.exchange.coinbase.com`, bucketed to `SAMPLE_MS`, newest trade per bucket wins (`app/api/history/route.ts:17-42`).
- Fallback: 1-min candles if trades unavailable or <2 points (`app/api/history/route.ts:45-57`).
- Both fail → `{ points: [] }`, HTTP 200 (`app/api/history/route.ts:68-69`) — socket refills in seconds, no error surfaced.
- Client merges seed + trims; `lastSampleAtRef` set to seed's newest ts so live feed continues seed cadence (`app/usePriceFeed.ts:46-54`).

## Freshness / settlement guard

- `getLivePrice()` returns last tick only if age < `FRESH_MS`=5s, else `null` (`app/usePriceFeed.ts:35-39`).
- `/api/price`: Coinbase spot → Binance fallback, each validated finite+positive before accept (`app/api/price/route.ts:23-37`). Both fail → 502 → UI retry button.

## Reconnection

- `connect()`: `onerror`+`onclose` both → `retry()`; `retried` flag dedupes double-fire (`app/usePriceFeed.ts:70`, `:108-117`).
- Backoff: `min(15000, 500 * 2^attempt)` → 500,1000,2000,4000,8000,capped 15000ms. `attempt` resets on open (`app/usePriceFeed.ts:74`).
- Cleanup nulls handlers before close to prevent reconnect-on-teardown (`app/usePriceFeed.ts:122-130`).

## Status values

`"connecting" | "live" | "reconnecting"` → dot color in UI (`app/page.tsx:158-169`).
