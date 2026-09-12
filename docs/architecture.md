# architecture

- No routing, no server state, no persistence. Game logic = client React state in one component.
- 2 API routes = stateless proxies to public exchange APIs. No decisions, no data held.

## Graph

```
app/page.tsx (menu: duel types × modes, links out — no game state)
  └─ app/duel/btc/quick-play/page.tsx (phase machine, predictions, countdown, settlement, winner)
       ├─ usePriceFeed() → price, sampled series, status
       └─ <PriceChart /> → pure SVG render

usePriceFeed() on mount  → GET /api/history        (seed)
usePriceFeed() ongoing   → wss://ws-feed.exchange.coinbase.com (live ticks, browser-direct)
quick-play/page.tsx settle() → GET /api/price      (fallback if socket stale)

/api/history → api.exchange.coinbase.com (trades → candles fallback)
/api/price   → api.coinbase.com → api.binance.com fallback chain
```

Only BTC Duel / Quick Play is wired up. Other duel types (ETH) and other
modes (Pulse Mode, 24hr Battle) are menu-only placeholders with no `href` —
see `docs/roadmap.md`.

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | menu: duel types × modes grid, links to implemented modes only |
| `app/duel/btc/quick-play/page.tsx` | phase machine, both players' inputs, countdown, settlement, winner, layout |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `SAMPLE_MS` — shared by client hook + server seed route |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed, bucketed to same resolution as socket |
| `app/layout.tsx` | root HTML, metadata, Tailwind import |

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-4`) — divergence = visible seam between seeded and live chart segments.
- Both API routes: `export const dynamic = "force-dynamic"`, `Cache-Control: no-store` (`app/api/price/route.ts:1`, `app/api/history/route.ts:3`). Never cache a price.
- All fetch paths degrade, never throw to the user: history → trades → candles → `[]` (`app/api/history/route.ts:59-69`); price → Coinbase → Binance → 502 (`app/api/price/route.ts:23-39`); settle → live tick → REST (`app/duel/btc/quick-play/page.tsx:60-62`).
- `PriceChart` must stay a pure function of props. Round/freeze logic belongs in the quick-play page (`app/duel/btc/quick-play/page.tsx:229-234`), not the chart. Same for lock timestamps: that page stamps `lockedAt{1,2}`, the chart just draws whatever `PredictionLine.at` it gets.
- `app/page.tsx` is menu-only: no fetch, no game state. Adding a real mode/duel type means adding a route and wiring its `href` in `DUEL_TYPES` (`app/page.tsx`), not touching the menu's rendering.

## Round data flow (sequence)

1. mount → `usePriceFeed` fetches `/api/history`, seeds series, opens socket
2. every ticker msg → updates headline price; 1 point/5s committed to series
3. both players lock → phase → `countdown`; each lock stamps `lockedAt{1,2}` (chart marker), 2nd also stamps `roundStart` (band edge)
4. 200ms interval counts down to fixed deadline → 0 → `settle()`
5. `settle()`: live tick if <5s old, else `/api/price` → diff1/diff2 → freeze chart snapshot → set winner
6. "Play Again" resets round state only; feed/socket persists
