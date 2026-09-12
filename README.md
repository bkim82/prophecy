# BTC Duel

A 1v1 Bitcoin duel with networked Quick Play predictions and Pulse live trading. Quick Play compares locked price guesses; Pulse compares server-settled leveraged P&L after both players choose a side.

Sign-in is optional — players are identified by an anonymous per-browser id. Nothing is staked: the wager is displayed, not charged. This is a prototype of the core loop, not a product.

```
lobby (queue) -> opponent joins -> both players ready -> countdown -> final price/P&L -> winner
```

## Quick start

```bash
npm install
npm run dev   # http://localhost:3000
```

Price sources are public and key-less, but Quick Play needs a Postgres database:

```bash
# .env.local — DATABASE_URL_UNPOOLED is what drizzle-kit pushes through
DATABASE_URL=postgres://…
DATABASE_URL_UNPOOLED=postgres://…
```

```bash
npm run db:push   # create the users/matches tables
```

To play yourself, open one normal window and one private window — player
identity lives in `localStorage`, so two windows of the same profile are the
same player.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 7 · Tailwind v4 · Drizzle + Neon Postgres · Clerk (optional sign-in). The chart is hand-rolled SVG; there is no charting library. Quick Play syncs by polling, not WebSockets — the only socket is the browser's direct price feed.

## Layout

```
app/
  page.tsx            lobby: ticker, mode/wager/timer controls, matchmaking
  duel/[market]/match/[matchId]/page.tsx   match room (polls server round state)
  duel/[market]/pulse/[matchId]/page.tsx   multiplayer Pulse room
  duel/btc/pulse/     solo leveraged-trading mode
  lib/playerId.ts     anonymous per-browser id
  usePriceFeed.ts     live feed (socket, seed, sampling)
  PriceChart.tsx      SVG chart
  feedConfig.ts       window/resolution shared by client and server
  api/match/*         match lifecycle: find-or-create, view, join, lock/action, leave, open list
  api/price/route.ts    REST spot price, used to settle
  api/history/route.ts  chart seed from recent trades
lib/
  match.ts            match state transitions, role-scoped views, presence
  spotPrice.ts        Coinbase -> Binance fallback chain
db/schema.ts          users + matches tables
docs/                 this documentation
```
