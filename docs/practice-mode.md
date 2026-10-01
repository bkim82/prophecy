# practice-mode

- Pulse practice reuses the solo trading loop at `app/duel/btc/pulse/page.tsx:162-216`; `?practice=1` labels the route as practice at `:147-153`, `:368` while preserving the `$100` bankroll, live trading, and final-money result.
- The lobby exposes a compact `Practice` action beside Play (`app/duel/page.tsx` `practiceHref`), BTC only; it is available before matchmaking starts and does not alter the queue or match state.
- The practice route uses the live client price feed and `/api/price` fallback for final pricing; no `matches` row, balance reservation, or payout is created.
