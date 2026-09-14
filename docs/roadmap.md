# roadmap

Deliberate gaps in a prototype scoped to the core loop. Not bugs.

## Not built

| Gap | Detail |
| --- | --- |
| 24hr Battle | Switcher entry only (`app/duel/page.tsx:63`, no `href` → panel locks, `:75`) — single prediction settled a day later, no implementation |
| ETH Duel | Lobby leaves ETH inert (`app/duel/page.tsx:95-99`, no `href`/`matched`). The feed, `/api/price`, the match routes and `/duel/[market]/match/[matchId]` all already handle `eth` — only the lobby entry is missing |
| Real rank/tier system | `app/lib/rank.ts` is a hardcoded stub (`MOCK_CURRENT_RANK`/`MOCK_RANK_THRESHOLD`) gating `/exclusive` — no computation, no persistence, not tied to Clerk `userId` |
| Post composer / feed persistence | `/` and `/exclusive` render static arrays from `app/lib/mockPosts.ts` — no create/like/reply, no database table, no Clerk-backed authorship |
| Daily BTC call | Feed's streak post (`app/lib/mockPosts.ts` `g-streak1`) implies a once-a-day BTC prediction settling at 11:59pm with a consecutive-day streak counter — no submission flow, settlement job, or streak computation exists anywhere in the app |
| Pulse leverage control | Fixed 1×–100× chips (`app/duel/btc/pulse/page.tsx:11`); no custom multiplier |
| Pulse spot accounting | `app/duel/btc/pulse/trading.ts` (`executeTrade`) is written and tested-by-eye but has no importers — the page models one leveraged directional position, not a cash/BTC portfolio |
| Pulse rival | "Nova · AI" is a local stub: side derived from the entry price's parity, fixed $48 × 10× size, no behaviour (`app/duel/btc/pulse/page.tsx:199-204`, `:301-306`) |
| No abandon timeout (`open` only) | `predict` is capped at 15s and forfeits (`lib/match.ts:81`), but an `open` match nobody joins just stops being listed once the heartbeat goes stale — the creator is held on the lobby and must press Cancel (`app/duel/page.tsx:263-277`) |
| No match cleanup | `matches` rows are never deleted after `settled`; stale `open` rows self-filter by heartbeat but still accumulate. No cron, no TTL (`app/api/match/open/route.ts:28`) |
| No persistence outside a match | Quick Play rounds persist in Postgres, but there is still no cross-round score or history; Pulse keeps nothing |
| No stakes | `matches.wager` is stored and displayed only — no balance deduction, no payout (`db/schema.ts:20`) |
| Round length vs chart window | Quick Play's timer is per-match now (10–3600s; lobby offers 60/120/300s), but any round > `WINDOW_MS`(1min) still scrolls off the chart's left edge before settling — the chart window is fixed |
| No axis-interval UI (zoom aside) | `PriceChart` already takes `windowMs`/`xIntervals`/`yIntervals`/`xMinorPerInterval` as props with `feedConfig.ts` defaults (`app/PriceChart.tsx:88-95`). The wheel drives time and price zoom only; a settings control changing `windowMs` also needs `WINDOW_MS` moved into state — the hook's `trim()` and the seed route both read the constant, so widening the window alone would show an empty left half until the series refills |
| BTC/USD only | Pair hardcoded in 5 places: socket sub (`app/usePriceFeed.ts:91`), REST ×2 (`app/api/price/route.ts:13`,`:18`), history ×2 (`app/api/history/route.ts:22`,`:58`). Coinbase/Binance spell pairs differently (`BTC-USD` vs `BTCUSDT`) |

## Quality gaps

- No tests, no `test` script. Pure/testable units: `fromTrades` bucketing, `trim()` window, live-edge merge in `points`, winner calc.
- No lint script (`package.json` has `dev`/`build`/`start` only).
- No CI (no `.github/workflows`).
- No error boundary — throw in page = full Next.js error screen mid-round.
- Two windows of one browser profile share `localStorage.playerId`, so a 2nd player on one machine needs a private window (`app/lib/playerId.ts:3-6`).

## Smaller items

- Tie = exact float match only (`lib/match.ts:136`) — matches UI copy, but no tolerance band option exists.
- `LOCK_SECONDS` is a constant (`lib/match.ts:34`), unlike `timerSeconds`: the lobby cannot offer a longer or shorter lock window.
- A forfeit settles with no `finalPrice`, so it contributes no chart freeze and no per-player diffs — the round simply never ran (`app/duel/[market]/match/[matchId]/page.tsx:531-557`).
- A queued lobby tab that reloads drops its queue; the row it left behind stays listed until the heartbeat goes stale (~8s) and cannot be re-entered from the list (`app/duel/page.tsx:391`).
- A settlement-price outage leaves the row in `countdown` past its deadline; the next poll retries, so a long outage shows "Settling…" indefinitely with no user-visible error (`lib/match.ts:130-132`).
- Clerk components (`UserButton`, sign-in modal) keep their own default appearance — not wired to `data-theme`.
- Pulse still hardcodes `ROUND_SECONDS=60` (`app/duel/btc/pulse/page.tsx:8`); Quick Play's length is per-match now, so the two no longer share a number.
- No chart hover/tooltip/crosshair.
- Slow `/api/history` can resolve after socket has already committed points — merge+trim (`app/usePriceFeed.ts:60`) keeps it correct but chart visibly re-draws.
- The 100ms clock (`app/usePriceFeed.ts:48-51`) re-renders the match room 10x/s even when nothing else changes, on top of the 1s poll. Cheap at this size; would want memoising the chart if the page grows.
- Candle backfill is coarse (1-min granularity is Coinbase's finest), so a trades outage draws the window as ~3 straight segments. Paginating trades via the `after` cursor would fill it properly.

## Next fork

Networking landed ([multiplayer-plan.md](multiplayer-plan.md)), so stakes are the
fork point now: `matches` carries `wager` and a settled winner, `users.balance`
exists, and nothing moves between them. Deducting on lock and paying on settle
needs a money path that survives the same races the round state does — and
`neon-http` still has no transactions, so it needs the same guarded-UPDATE
discipline plus an idempotency key per match.
