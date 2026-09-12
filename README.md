# BTC Duel

A 1v1 Bitcoin price prediction duel that runs entirely on one screen. Two players share the same browser, each locks a guess for what BTC/USD will be 60 seconds from now, and the closest guess wins.

There is no networking, no auth, and no persistence. This is a prototype of the core loop, not a product.

```
live price -> both players lock -> 60s countdown -> final price -> winner -> play again
```

## Quick start

```bash
npm install
npm run dev   # http://localhost:3000
```

No API key and no `.env` required — every price source is public and key-less.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 7 · Tailwind v4. The chart is hand-rolled SVG; there is no charting library.

## Docs

| Document | What's in it |
| --- | --- |
| [Architecture](docs/architecture.md) | Module map, data flow, and the decisions behind the shape |
| [Price feed](docs/price-feed.md) | The websocket, the history seed, the REST fallback, and sampling |
| [Game loop](docs/game-loop.md) | Phase machine, locking, countdown, and settlement |
| [Chart](docs/chart.md) | The SVG renderer, scaling, and overlays |
| [Roadmap](docs/roadmap.md) | What is deliberately missing and what it would take to add |

## Layout

```
app/
  page.tsx            round state machine + UI
  usePriceFeed.ts     live BTC feed (socket, seed, sampling)
  PriceChart.tsx      SVG chart
  feedConfig.ts       window/resolution shared by client and server
  api/price/route.ts    REST spot price, used to settle
  api/history/route.ts  chart seed from recent trades
docs/                 this documentation
```
