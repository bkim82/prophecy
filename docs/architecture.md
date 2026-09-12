# Architecture

## Shape

The app is a single page with no routing, no server state, and no persistence. All game logic is client-side React state inside one component. The two API routes are thin proxies to public exchange endpoints — they hold no state and make no decisions about the game.

```
Browser
┌───────────────────────────────────────────────────────────┐
│  app/page.tsx            phase machine, predictions,      │
│      │                   countdown, settlement, winner    │
│      ├── usePriceFeed()  price + sampled series + status  │
│      └── <PriceChart />  pure SVG rendering               │
└───────────────────────────────────────────────────────────┘
      │ seed on mount      │ live ticks          │ settle fallback
      ▼                    ▼                     ▼
  /api/history     wss://ws-feed.exchange    /api/price
   (route)          .coinbase.com             (route)
      │             (browser connects              │
      ▼              directly)                     ▼
 api.exchange.coinbase.com               api.coinbase.com  ->
   trades  ->  candles                     api.binance.com
```

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | The whole game: phase machine, both players' inputs, countdown, settlement, winner, and layout |
| `app/usePriceFeed.ts` | Owns the websocket, the history seed, reconnection, and the sampled series |
| `app/PriceChart.tsx` | Pure function of props to SVG. No data fetching, no state |
| `app/feedConfig.ts` | `WINDOW_MS` and `SAMPLE_MS`, imported by both the client hook and the server seed route |
| `app/api/price/route.ts` | REST spot price with a two-source fallback chain |
| `app/api/history/route.ts` | Chart seed, bucketed to the same resolution the socket produces |
| `app/layout.tsx` | Root HTML, metadata, Tailwind import |

## Why the pieces sit where they do

**The websocket runs in the browser, not on the server.** Coinbase's public ticker feed needs no key, so there is nothing to hide and no reason to pay for a server relay. It also means ticks reach the UI with no extra hop.

**`feedConfig.ts` is shared rather than duplicated.** The seed endpoint buckets trades into `SAMPLE_MS` slots and the live hook commits one point per `SAMPLE_MS`. If those two numbers drifted apart, the seeded portion of the chart would have a visibly different density from the live portion. Sharing the constants makes that impossible (`app/feedConfig.ts:3-4`).

**Both API routes are `force-dynamic` and `no-store`.** A cached price is a wrong price. Every route sets `export const dynamic = "force-dynamic"` and returns `Cache-Control: no-store` (`app/api/price/route.ts:1`, `app/api/history/route.ts:3`).

**Every fetch path degrades instead of failing.** The history route tries trades, then candles, then returns an empty array, because the chart fills itself from the socket within seconds anyway (`app/api/history/route.ts:59-69`). The price route tries Coinbase, then Binance, and only then returns 502 (`app/api/price/route.ts:23-39`). Settlement prefers the live tick and falls back to REST (`app/page.tsx:56-61`).

**The chart component is deliberately dumb.** It takes points and prediction lines and returns SVG. Freezing the chart at settlement is done by the page passing a frozen array (`app/page.tsx:211`), not by the chart knowing what a round is.

## Data flow for one round

1. On mount, `usePriceFeed` fetches `/api/history` and seeds the series, then opens the websocket.
2. Every ticker message updates the headline price; one point per 5s is committed to the plotted series.
3. Each player types a number and locks it. When both are locked, the phase flips to `countdown` and `roundStart` is stamped.
4. A 200ms interval counts down against a fixed deadline. At zero, `settle()` runs.
5. `settle()` takes the live tick if it is fresher than 5s, otherwise fetches `/api/price`. It computes both absolute differences, freezes the chart series, and sets the winner.
6. "Play Again" resets every piece of round state; the feed is never torn down.
