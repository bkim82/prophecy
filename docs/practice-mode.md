# practice-mode

- Pulse practice reuses the solo trading loop at `app/duel/btc/pulse/page.tsx:133-180`; `?practice=1` labels the route as practice and `?market=btc|eth` picks the feed/labels (`:94-98`, `:118-123`, `:339`) — unknown markets fall back to BTC via `productForMarket`; preserves the `$100` bankroll, live trading, and final-money result.
- The lobby exposes "Practice with play money" under Play (`app/duel/page.tsx` `practiceHref` → `/duel/btc/pulse?practice=1&market=<tab>`), on every market; it is available before matchmaking starts and does not alter the queue or match state.
- The practice route uses the live client price feed and `/api/price?symbol=<product>` fallback for final pricing; no `matches` row, balance reservation, or payout is created.
- In-match UI is the shared `MatchScreen` (`app/PulseMatch.tsx`, see [pulse-mode.md](pulse-mode.md)): mode pills "PRACTICE" + "PULSE · 60s", practice win streak in localStorage `pulse-streak-practice`, result screen adds "Play for real" → `/duel`. Positions liquidate at −stake like real matches.
