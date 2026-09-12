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
| Fixed round length | `ROUND_SECONDS=60` hardcoded (`app/page.tsx:7`). Configurable is easy but a round > `WINDOW_MS`(3min) scrolls off chart's left edge before settling |
| BTC/USD only | Pair hardcoded in 5 places: socket sub (`app/usePriceFeed.ts:79`), REST ×2 (`app/api/price/route.ts:13`,`:18`), history ×2 (`app/api/history/route.ts:19`,`:47`). Coinbase/Binance spell pairs differently (`BTC-USD` vs `BTCUSDT`) |

## Quality gaps

- No tests, no `test` script. Pure/testable units: `fromTrades` bucketing, `trim()` window, live-edge merge in `points`, winner calc.
- No lint script (`package.json` has `dev`/`build`/`start` only).
- No CI (no `.github/workflows`).
- No error boundary — throw in page = full Next.js error screen mid-round.

## Smaller items

- Tie = exact float match only (`app/page.tsx:75`) — matches UI copy, but no tolerance band option exists.
- `roundStart` stamped in `lock()`, deadline computed later in countdown effect (`app/page.tsx:117` vs `:89`) — 1-render gap, invisible today, would need merging if timing becomes authoritative.
- Light mode only, no `prefers-color-scheme`.
- No chart hover/tooltip/crosshair.
- Slow `/api/history` can resolve after socket has already committed points — merge+trim (`app/usePriceFeed.ts:48`) keeps it correct but chart visibly re-draws.

## Next fork

Networking is the fork point. Everything else here is cheap in isolation; real multiplayer moves round state to a server, settlement stops being a client fetch, `/api/price` becomes authority not fallback. Decide before adding score/stakes — both would need rewriting once a server owns the round.
