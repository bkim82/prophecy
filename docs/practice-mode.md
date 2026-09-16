# practice-mode

- Quick Play practice is client-only at `app/duel/[market]/practice/page.tsx:34-271`: a 60-second prediction round, no sign-in, no opponent, no wager; settlement reports final price, absolute distance, and percentage error (`:64-88`, `:236-264`).
- Pulse practice reuses the solo trading loop at `app/duel/btc/pulse/page.tsx:162-216`; `?practice=1` labels the route as practice at `:147-153`, `:368` while preserving the `$100` bankroll, live trading, and final-money result.
- The lobby exposes a compact `Practice` action beside Play at `app/duel/page.tsx:484-496`; it is available before matchmaking starts and does not alter the queue or match state.
- Practice routes use the live client price feed and `/api/price` fallback for final pricing; no `matches` row, balance reservation, or payout is created.
