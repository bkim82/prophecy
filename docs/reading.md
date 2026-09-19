# 24h Reading

Status: built for BTC and ETH. Solo, server-authoritative, DB-backed —
unlike Quick Play/Pulse there is no opponent and no `matches` row; each call
is its own `readings` row (`db/schema.ts`).

## Shape

- One call per 6-hour window per user per market: a leveraged long/short wager locked in at the live price when placed, with no manual close — it settles automatically the instant the window ends.
- Windows reset at 00:00/06:00/12:00/18:00 in **the caller's own local time**, not a shared UTC clock. The browser reports `Date.prototype.getTimezoneOffset()` as `tzOffsetMinutes` on every request; the server computes boundaries from it and stores them as absolute `timestamptz` instants on the row (`lib/readingRules.ts:38` `readingWindowFor`) — they are never recomputed from a later clock read.
- `id = "${userId}:${market}:${windowStartAt epoch ms}"` (`lib/readingRules.ts:60`) — deterministic per user/market/window, so a second call in the same window collides on `INSERT ... ON CONFLICT DO NOTHING` (`app/api/reading/route.ts`) rather than needing a read-then-write check.
- Leverage: fixed chips `1×/5×/10×/20×` (`lib/readingRules.ts:8` `READING_LEVERAGE_OPTIONS`) — far below Pulse's 100×-10,000× chips, sized for a 6-hour move instead of a 60-second one. Wager is any integer embers up to the caller's balance (reserved atomically on placement, `lib/balance.ts`).
- P&L: `wager × priceMove% × leverage`, sign flipped for short, realized loss floored at `-wager` (same stop-out shape as Pulse, `lib/readingRules.ts:64` `readingPnl`). Settlement pays `wager + pnl` back to the user via an idempotent ledger (`reading_payouts` table, `lib/reading.ts` `creditReadingPayout`), mirroring `lib/balance.ts creditPayout`.
- Auth-gated (Clerk `userId`), unlike Quick Play/Pulse's anonymous `playerId` — calls, wagers and stats are tied to the account, not the browser.

## Module split

- `lib/readingRules.ts` — pure math and window/id rules, **no DB import**. Client-safe (mirrors `lib/pulse.ts` sitting next to the DB-touching `lib/match.ts`); the reading page imports `readingPnl`/`READING_LEVERAGE_OPTIONS` from here for the live unrealized-P&L preview.
- `lib/reading.ts` — DB layer: lazy settlement, stats aggregation, payout ledger. Re-exports everything from `readingRules.ts` so API routes only need one import.

## Settlement (lazy, like `settleIfDue`)

`settleReadingsIfDue(userId)` (`lib/reading.ts`) runs on every `GET /api/reading`:
finds this user's `status='open'` rows whose `windowEndAt` has passed, fetches
`getSpotPrice()` per row, and writes the result under a
`status='open' AND id=...` guard — idempotent under concurrent polls, same
shape as `lib/match.ts settleIfDue`. A price-source outage leaves the row
`open` for the next poll to retry; nothing is lost.

## Stats

`readingStatsFor(userId, market, dayStartAt)` (`lib/reading.ts`) aggregates
settled rows via SQL `sum`/`case when`, scoped per market:
- **Cumulative P&L** — sum of `pnl` across every settled call ever.
- **Day P&L** — same sum, scoped to `windowStartAt >= dayStartAt` where `dayStartAt` is the caller's local midnight (`lib/readingRules.ts` `readingDayStartFor`).
- **Record** — one combined row, not separate accuracy/wins/losses rows: `{wins}W – {losses}L · {accuracy}%` (`app/duel/[market]/reading/page.tsx` `record`).

`readingCalendarFor(userId, market, monthStartAt, monthEndAt, tzOffsetMinutes)`
(`lib/reading.ts`) is the calendar tile's data source: fetches this month's
settled rows (`[monthStartAt, monthEndAt)` from `readingMonthRangeFor`,
`lib/readingRules.ts`) and buckets each by the local day-of-month its window
started on (`readingLocalDayOfMonth`), summing `pnl` and counting wins/losses
per day. Days with no settled calls are simply absent from the array — the
client renders those as empty, not as a loss.

## Routes

| Route | Does |
| --- | --- |
| `GET /api/reading?market=&tzOffsetMinutes=` | settles due calls, then returns the current window bounds, this window's call (if any, now including `placedAt`), stats, and this local month's per-day P&L (`calendar: ReadingCalendarDay[]`) |
| `POST /api/reading` `{market, side, wager, leverage, tzOffsetMinutes}` | reserves the wager, fetches the live price, inserts the call; 409 if this window already has one, 402 on insufficient balance |

`ReadingView.placedAt` (`lib/reading.ts`) is the row's `createdAt`, i.e. the
instant the call was placed — distinct from `windowStartAt`, since a call can
land anywhere inside its 6h window, not just at the boundary. It's what the
client's "time in trade" stopwatch counts up from.

## Client

- `app/duel/[market]/reading/page.tsx` — polls `GET /api/reading` every 3s; a local 1s ticker drives the "resets in HH:MM:SS" countdown off `serverNow`-corrected `windowEndAt`, same skew-correction pattern as the match room.
- Reuses `usePriceFeed`/`<PriceChart>` for the live price and chart, but passes no `roundStart`/trade markers — a 6-hour window dwarfs the chart's ~1-3min visible span, so shading it would just read as solid background.
- `app/duel/page.tsx` mode switcher: `battle-24h` now renders the calendar/countdown `Battle24h` UI inline for BTC/ETH, with its call actions backed by `/api/reading`; the standalone `/duel/[market]/reading` route remains available and DOGE stays `href`-less/inert because `lib/spotPrice.ts` has no DOGE product.
- `app/Battle24h.tsx`: once a call is open, the countdown tile switches from "Locks in" (time left in the window) to "In trade" — elapsed time since `current.placedAt`, ticking up every second, since P&L accrues with the open position rather than with the window itself. The record grid shows the open position's wager, leverage, entry price, and live unrealized P&L (`readingPnl` from `lib/readingRules.ts`, same live-preview pattern as the standalone room) instead of streak/win/loss counts. Accuracy sits under the calendar tile instead of in the record grid; each calendar day carries a `title` (native tooltip) and an `aria-label` with that day's summed P&L from `reading.calendar`.

## Known non-behaviors

- No history/list of individual past calls in the UI — the calendar shows a day's *summed* P&L, not each call within it. `readings` rows accumulate with no cleanup, same as `matches`.
- BTC/ETH only, same limitation as the rest of the app (`lib/spotPrice.ts SUPPORTED_PRODUCTS`).
