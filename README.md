# BTC Duel (prototype)

1v1 Bitcoin price prediction duel on a single screen. Both players play in the same browser; there is no networking, auth, or persistence.

Loop: live BTC price -> two predictions -> lock -> 60s countdown -> final price -> winner -> play again.

```bash
npm install
npm run dev   # http://localhost:3000
```

Price comes from Coinbase: the browser subscribes to the public `ws-feed.exchange.coinbase.com` ticker socket for live ticks, `/api/history` seeds the chart by bucketing ~1000 recent trades at the same 5s resolution (falling back to one-minute candles), and `/api/price` is the REST fallback used to settle a round if the socket drops. No API key needed.

The chart is hand-rolled SVG (no chart library): a 3-minute rolling window committing one point every 5 seconds (`app/feedConfig.ts`), dashed lines for each locked prediction, and a shaded band marking the live round. Every trade still updates the headline price and the leading point; only the plotted series is sampled, because tick-dense data draws as a flat band.
