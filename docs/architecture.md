# architecture

- No routing, no server state, no persistence. Game logic = client React state in one component.
- 2 API routes = stateless proxies to public exchange APIs. No decisions, no data held.

## Graph

```
app/page.tsx (menu: duel types × modes, links out — no game state)
  ├─ app/duel/btc/quick-play/page.tsx (phase machine, predictions, countdown, settlement, winner)
  ├─ app/duel/btc/pulse/page.tsx (solo trades, countdown, leveraged P&L, settlement)
  └─ both modes
       ├─ usePriceFeed() → price, sampled series, status, now (250ms clock)
       └─ <PriceChart /> → pure SVG render, fixed-width scrolling window

usePriceFeed() on mount  → GET /api/history        (seed)
usePriceFeed() ongoing   → wss://ws-feed.exchange.coinbase.com (live ticks, browser-direct)
quick-play/page.tsx settle() → GET /api/price      (fallback if socket stale)

/api/history → api.exchange.coinbase.com (trades + candles, both, merged)
/api/price   → api.coinbase.com → api.binance.com fallback chain
```

BTC Duel / Quick Play and Pulse Mode are wired up. ETH and 24hr Battle remain
menu-only placeholders with no `href` — see `docs/roadmap.md`.

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | menu: duel types × modes grid, links to implemented modes only |
| `app/duel/btc/quick-play/page.tsx` | phase machine, both players' inputs, countdown, settlement, winner, layout |
| `app/duel/btc/pulse/page.tsx` | solo trading state, countdown, leveraged P&L, settlement, layout |
| `app/duel/btc/pulse/trading.ts` | pure buy/sell portfolio accounting and full-position clamping |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, metadata, Tailwind import |

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-10`) — divergence = visible seam between seeded and live chart segments.
- The chart's x-domain is a **fixed window ending now**, never the extent of the data (`app/PriceChart.tsx:101-108`). Deriving it from the data is what made the axis cram as points accumulated.
- `trim()` and `/api/history` must cut at the same `WINDOW_MS + SAMPLE_MS`, one sample wider than the window (`app/usePriceFeed.ts:16`, `app/api/history/route.ts:92`) — the chart interpolates its left-edge crossing from that extra point.
- Both API routes: `export const dynamic = "force-dynamic"`, `Cache-Control: no-store` (`app/api/price/route.ts:1`, `app/api/history/route.ts:3`). Never cache a price.
- All fetch paths degrade, never throw to the user: history → trades ∪ candles → `[]` (`app/api/history/route.ts:88-110`); price → Coinbase → Binance → 502 (`app/api/price/route.ts:23-39`); settle → live tick → REST (`app/duel/btc/quick-play/page.tsx:65-69`).
- `PriceChart` must stay a pure function of props — including its clock, which arrives as the `now` prop rather than a `Date.now()` read or an interval of its own (`app/duel/btc/quick-play/page.tsx:261`). Round/freeze logic belongs in the quick-play page (`app/duel/btc/quick-play/page.tsx:255-263`), not the chart. Same for lock timestamps: that page stamps `lockedAt{1,2}`, the chart just draws whatever `PredictionLine.at` it gets.
- `app/page.tsx` is menu-only: no fetch, no game state. Adding a real mode/duel type means adding a route and wiring its `href` in `DUEL_TYPES` (`app/page.tsx`), not touching the menu's rendering.

## Round data flow (sequence)

1. mount → `usePriceFeed` fetches `/api/history` (full window, trades + candle backfill), seeds series, opens socket, starts the 250ms clock
2. every ticker msg → updates headline price; 1 point/5s committed to series
3. both players lock → phase → `countdown`; each lock stamps `lockedAt{1,2}` (chart marker), 2nd also stamps `roundStart` (band edge)
4. 200ms interval counts down to fixed deadline → 0 → `settle()`
5. `settle()`: live tick if <5s old, else `/api/price` → diff1/diff2 → freeze chart snapshot → set winner
6. "Play Again" resets round state only; feed/socket persists
