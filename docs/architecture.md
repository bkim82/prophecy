# architecture

- Root shell = compact market lobby. Live home ticker reads the client-side BTC feed; no server state or persistence.
- 2 API routes = stateless proxies to public exchange APIs. No decisions, no data held.

## Graph

```
app/layout.tsx (root shell: DUEL, balance, profile)
  └── app/page.tsx (live lobby: BTC ticker, mini-chart, quick-play controls, match rows)
        └── usePriceFeed() → price, sampled series, status, now
app/duel/btc/quick-play/page.tsx (phase machine, predictions, countdown, settlement, winner)
app/duel/btc/pulse/page.tsx (solo trades, countdown, leveraged P&L, settlement)
  ├── usePriceFeed() → price, sampled series, status, now
  └── <PriceChart /> → pure SVG render, fixed-width scrolling window

usePriceFeed() on mount → GET /api/history (seed)
usePriceFeed() ongoing → wss://ws-feed.exchange.coinbase.com (live ticks, browser-direct)
{quick-play,pulse}/page.tsx settle() → GET /api/price → fallback if socket stale

/api/history → api.exchange.coinbase.com (trades + candles, both, merged)
/api/price   → api.coinbase.com → api.binance.com fallback chain
```

BTC Duel / Quick Play and Pulse are wired up. ETH and 24hr Battle are
lobby-only placeholders with no route — selectable in the lobby mode switcher,
which locks the play panel when the chosen mode has no `href`
(`app/page.tsx:60-64`, `:75`). Direction/Entry are Quick Play's controls only:
Pulse takes its stake and leverage in-round, so `takesCall` greys them and
drops the query string from its href (`app/page.tsx:78-81`).

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | live lobby, BTC ticker/chart, mode switcher (`MODES`), quick-play controls, match/result rows |
| `app/duel/btc/quick-play/page.tsx` | phase machine, both players' inputs, countdown, settlement, winner, layout |
| `app/duel/btc/pulse/page.tsx` | solo trading state, countdown, leveraged P&L, settlement, layout |
| `app/duel/btc/pulse/trading.ts` | pure buy/sell portfolio accounting and full-position clamping — **no importers yet**, the page tracks a single leveraged position instead |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `MIN_WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, header shell, Clerk provider, metadata, Tailwind import, pre-paint theme script |
| `app/ThemeToggle.tsx` | header light/dark button, writes `data-theme` + `localStorage` |
| `app/theme.ts` | `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` — shared by layout (server) and toggle (client) |

## Theming

- Two themes, one token set. `:root` = dark (default), `[data-theme="light"]` redefines the same names (`app/globals.css:5-28`). No color literal belongs anywhere else — `PriceChart.tsx`, `quick-play/page.tsx` and `pulse/page.tsx` use `var(--…)` in Tailwind arbitrary values, SVG presentation attributes and inline `style` alike.
- Resolution order: `localStorage.theme` → `prefers-color-scheme` → dark (`app/theme.ts:9`, mirrored by `readTheme()` in `app/ThemeToggle.tsx:7-15`). Both readers must stay in sync.
- `<html data-theme="dark" suppressHydrationWarning>` + the inline `<head>` script set the attribute during HTML parsing, before first paint (`app/layout.tsx:15-18`). `useLayoutEffect` in the toggle re-applies it after Strict Mode's dev remount clears `<html>`'s attributes.

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-10`) — divergence = visible seam between seeded and live chart segments.
- The chart's x-domain is a **fixed window ending now**, never the extent of the data (`app/PriceChart.tsx:101-108`). Deriving it from the data is what made the axis cram as points accumulated.
- `trim()` and `/api/history` must cut at the same `WINDOW_MS + SAMPLE_MS`, one sample wider than the window (`app/usePriceFeed.ts:16`, `app/api/history/route.ts:92`) — the chart interpolates its left-edge crossing from that extra point.
- Both API routes: `export const dynamic = "force-dynamic"`, `Cache-Control: no-store` (`app/api/price/route.ts:1`, `app/api/history/route.ts:3`). Never cache a price.
- All fetch paths degrade, never throw to the user: history → trades ∪ candles → `[]` (`app/api/history/route.ts:88-110`); price → Coinbase → Binance → 502 (`app/api/price/route.ts:23-39`); settle → live tick → REST (`app/duel/btc/quick-play/page.tsx:65-69`).
- `PriceChart` holds only its time and price wheel zoom levels (`docs/chart.md` → Zoom), and otherwise stays a pure function of props — including its clock, which arrives as the `now` prop rather than a `Date.now()` read or an interval of its own (`app/duel/btc/quick-play/page.tsx:261`). Round/freeze logic belongs in the quick-play page (`app/duel/btc/quick-play/page.tsx:255-263`), not the chart. Same for lock timestamps: that page stamps `lockedAt{1,2}`, the chart just draws whatever `PredictionLine.at` it gets.
- Color literals stay out of components: add a token to `app/globals.css` and define it in both blocks, or the toggle silently breaks in one theme.
- The home lobby may read `usePriceFeed()` for live market display (`app/page.tsx:67`), but settlement logic remains in the per-mode routes.
- Pulse long/short reuse `--chart-up`/`--chart-down` (`app/duel/btc/pulse/page.tsx:16-17`), so a chart marker matches the control that placed it. P&L sign uses `--positive`/`--negative` (`:71`).

## Round data flow (sequence)

1. mount → `/api/history` seeds the series, socket opens, 250ms clock starts
2. every ticker msg → updates headline price; 1 point/5s committed to series
3. both players lock → phase → `countdown`; second lock stamps `roundStart`
4. 200ms interval counts down to fixed deadline → 0 → `settle()`
5. `settle()`: live tick if <5s old, else `/api/price` → diff1/diff2 → freeze chart snapshot → set winner
6. “Play Again” resets round state only; feed/socket persists
