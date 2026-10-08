# practice-mode

- Pulse practice reuses the solo trading loop at `app/duel/btc/pulse/page.tsx:133-180`; `?practice=1` labels the route as practice and `?market=btc|eth` picks the feed/labels (`:94-98`, `:118-123`, `:339`) — unknown markets fall back to BTC via `productForMarket`; preserves the `$100` bankroll, live trading, and final-money result.
- The lobby exposes a compact `Practice` action beside Play (`app/duel/page.tsx` `practiceHref` → `/duel/btc/pulse?practice=1&market=<tab>`), shown for any market whose Pulse is `matched` (BTC, ETH); it is available before matchmaking starts and does not alter the queue or match state.
- The practice route uses the live client price feed and `/api/price?symbol=<product>` fallback for final pricing; no `matches` row, balance reservation, or payout is created.
