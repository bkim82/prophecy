# roadmap

Deliberate gaps in a prototype scoped to the core loop. Not bugs.

## Not built

| Gap | Detail |
| --- | --- |
| Pulse Mode | Menu placeholder only (`app/page.tsx` `MODES`, no `href`) — rapid-fire back-to-back rounds, no implementation |
| 24hr Battle | Menu placeholder only (`app/page.tsx` `MODES`, no `href`) — single prediction settled a day later, no implementation |
| ETH Duel | Menu placeholder only (`app/page.tsx` `DUEL_TYPES`) — no price feed, routes, or settlement |
| Same-browser 2P | Both predictions typed on one keyboard — no hidden input/commit step, either player sees the other's guess pre-lock |
| No networking | No room/matchmaking/2nd client. Real multiplayer needs server-held round state — currently `/api/price`, `/api/history` are stateless proxies by design |
| No persistence | Reload loses everything. No cross-round score/history/identity |
| No stakes | Predictions free, wins pay nothing |
| Fixed round length | `ROUND_SECONDS=60` hardcoded (`app/duel/btc/quick-play/page.tsx:8`). Configurable is easy but a round > `WINDOW_MS`(3min) scrolls off chart's left edge before settling |
| No axis-interval UI | `PriceChart` already takes `windowMs`/`xIntervals`/`yIntervals`/`xMinorPerInterval` as props with `feedConfig.ts` defaults (`app/PriceChart.tsx:88-95`). Nothing surfaces them yet. A control changing `windowMs` also needs `WINDOW_MS` moved into state — the hook's `trim()` and the seed route both read the constant, so widening the window alone would show an empty left half until the series refills |
| BTC/USD only | Pair hardcoded in 5 places: socket sub (`app/usePriceFeed.ts:91`), REST ×2 (`app/api/price/route.ts:13`,`:18`), history ×2 (`app/api/history/route.ts:22`,`:58`). Coinbase/Binance spell pairs differently (`BTC-USD` vs `BTCUSDT`) |

## Quality gaps

- No tests, no `test` script. Pure/testable units: `fromTrades` bucketing, `trim()` window, live-edge merge in `points`, winner calc.
- No lint script (`package.json` has `dev`/`build`/`start` only).
- No CI (no `.github/workflows`).
- No error boundary — throw in page = full Next.js error screen mid-round.

## Smaller items

- Tie = exact float match only (`app/duel/btc/quick-play/page.tsx:84`) — matches UI copy, but no tolerance band option exists.
- `roundStart` stamped in `lock()`, deadline computed later in countdown effect (`app/duel/btc/quick-play/page.tsx:144` vs `:110`) — 1-render gap, invisible today, would need merging if timing becomes authoritative.
- Light mode only, no `prefers-color-scheme`.
- No chart hover/tooltip/crosshair.
- Slow `/api/history` can resolve after socket has already committed points — merge+trim (`app/usePriceFeed.ts:60`) keeps it correct but chart visibly re-draws.
- The 250ms clock (`app/usePriceFeed.ts:48-51`) re-renders the quick-play page 4x/s even when nothing else changes. Cheap at this size; would want memoising the chart if the page grows.
- Candle backfill is coarse (1-min granularity is Coinbase's finest), so a trades outage draws the window as ~3 straight segments. Paginating trades via the `after` cursor would fill it properly.

## Next fork

Networking is the fork point. Everything else here is cheap in isolation; real multiplayer moves round state to a server, settlement stops being a client fetch, `/api/price` becomes authority not fallback. Decide before adding score/stakes — both would need rewriting once a server owns the round.
