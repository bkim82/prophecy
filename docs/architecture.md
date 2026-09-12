# architecture

- Root shell = compact market lobby. Live home ticker reads the client-side BTC feed; no server state or persistence.
- 2 API routes = stateless proxies to public exchange APIs. No decisions, no data held.

## Graph

```
app/layout.tsx (root shell: DUEL, balance, profile)
  └── app/page.tsx (live lobby: BTC ticker, mini-chart, quick-play controls, match rows)
        └── usePriceFeed() → price, sampled series, status, now
app/duel/btc/quick-play/page.tsx (phase machine, predictions, countdown, settlement, winner)
  ├── usePriceFeed() → price, sampled series, status, now
  └── <PriceChart /> → pure SVG render, fixed-width scrolling window

usePriceFeed() on mount → GET /api/history (seed)
usePriceFeed() ongoing → wss://ws-feed.exchange.coinbase.com (live ticks, browser-direct)
quick-play/page.tsx settle() → GET /api/price → fallback if socket stale

/api/history → api.exchange.coinbase.com (trades + candles, both, merged)
/api/price   → api.coinbase.com → api.binance.com fallback chain
```

Only BTC Duel / Quick Play is wired up. Other duel types (ETH) and other
modes (Pulse Mode, 24hr Battle) are lobby-only placeholders with no route.

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | live lobby, BTC ticker/chart, quick-play controls, match/result rows |
| `app/duel/btc/quick-play/page.tsx` | phase machine, both players' inputs, countdown, settlement, winner, layout |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, header shell, Clerk provider, metadata, Tailwind import |

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-10`) — divergence = visible seam between seeded and live chart.
- The chart's x-domain is a fixed window ending now, never the extent of the data (`app/PriceChart.tsx:101-108`).
- `trim()` and `/api/history` must cut at the same `WINDOW_MS + SAMPLE_MS` (`app/usePriceFeed.ts:16`, `app/api/history/route.ts:92`).
- Both API routes: `export const dynamic = "force-dynamic"`, `Cache-Control: no-store`.
- All fetch paths degrade, never throw to the user.
- `PriceChart` stays a pure function of props, including its clock from the `now` prop. Round/freeze logic belongs in quick play.
- The home lobby may read `usePriceFeed()` for live market display, but settlement logic remains in the quick-play route.

## Round data flow (sequence)

1. mount → `/api/history` seeds the series, socket opens, 250ms clock starts
2. every ticker msg → updates headline price; 1 point/5s committed to series
3. both players lock → phase → `countdown`; second lock stamps `roundStart`
4. 200ms interval counts down to fixed deadline → 0 → `settle()`
5. `settle()`: live tick if <5s old, else `/api/price` → diff1/diff2 → freeze chart snapshot → set winner
6. “Play Again” resets round state only; feed/socket persists
