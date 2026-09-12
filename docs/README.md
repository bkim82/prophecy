# BTC Duel docs

Documentation for the prototype as it actually stands today. Every claim here was read off the source; where something is unbuilt it is listed in the [roadmap](roadmap.md) rather than described as if it exists.

| Document | Read it when |
| --- | --- |
| [Architecture](architecture.md) | You want the module map and how a price gets from Coinbase to the screen |
| [Price feed](price-feed.md) | You are touching the socket, the seed endpoint, or the sampling rate |
| [Game loop](game-loop.md) | You are changing round length, locking rules, or how a winner is decided |
| [Chart](chart.md) | You are changing how the price line, prediction levels, or axes render |
| [Roadmap](roadmap.md) | You want to know what is missing and why |

## Orientation in one paragraph

Everything runs in the browser. `app/page.tsx` holds the round state machine and calls `usePriceFeed()` for a live BTC/USD price plus a sampled series; it passes that series to `<PriceChart />`, which draws it as SVG. Two server routes exist only to dodge browser CORS limits and to provide a fallback: `/api/history` seeds the chart on first load, and `/api/price` supplies a settlement price if the websocket is not delivering. There is no database, no session, and no server-side game state.
