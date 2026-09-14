# architecture

- Root shell now has three top-level destinations via a persistent tab nav (`app/TabNav.tsx`): `/` (Global feed), `/exclusive` (rank-gated feed), `/duel` (the market lobby, moved from `app/page.tsx`). Live ticker on `/duel` reads the client-side BTC feed.
- Quick Play and multiplayer Pulse are server-authoritative: a `matches` row owns the round (`db/schema.ts:20`), `/api/match/*` routes own the transitions, clients poll. See [multiplayer-plan.md](multiplayer-plan.md).
- `/api/price` and `/api/history` remain stateless proxies to public exchange APIs. The price feed and chart stay client-side in every mode.

## Graph

```
app/layout.tsx (root shell: DUEL, balance, profile)
  ├── app/TabNav.tsx (persistent Global / Exclusive / Duel tab switcher)
  ├── app/page.tsx (Global feed: mock PostCard list, app/lib/mockPosts.ts)
  ├── app/exclusive/page.tsx (Exclusive feed: rank-gated via app/lib/rank.ts stub)
  └── app/duel/page.tsx (live lobby: BTC ticker, mini-chart, quick-play controls, match rows)
        └── usePriceFeed() → price, sampled series, status, now
app/duel/[market]/match/[matchId]/page.tsx (Quick Play prediction room)
app/duel/[market]/pulse/[matchId]/page.tsx (multiplayer Pulse positions, countdown, result)
app/duel/btc/pulse/page.tsx (solo trades, countdown, leveraged P&L, settlement)
  ├── usePriceFeed() → price, sampled series, status, now
  └── <PriceChart /> → pure SVG render, fixed-width scrolling window

usePriceFeed() on mount → GET /api/history (seed)
usePriceFeed() ongoing → wss://ws-feed.exchange.coinbase.com (live ticks, browser-direct)
multiplayer Pulse room → POST /api/match/[id]/action → server multi-position entry/close + settlement
pulse/page.tsx settle() → GET /api/price → fallback if socket stale (solo route)

duel/page.tsx Play → POST /api/match/find-or-create → mode-specific match room
duel/page.tsx lobby list → GET /api/match/open (3s poll) → POST .../join
match room → GET /api/match/[id] (1s poll: view + heartbeat + lazy settle)
match room → POST /api/match/[id]/{lock,action,leave}
/api/match/* → Neon Postgres (matches); settlement → lib/spotPrice.ts

/api/history → api.exchange.coinbase.com (trades + candles, both, merged)
/api/price   → lib/spotPrice.ts → api.coinbase.com → api.binance.com fallback chain
```

BTC Quick Play and multiplayer Pulse are wired up. ETH and 24hr Battle are lobby-only
placeholders — selectable in the mode switcher, which locks the play panel when
the chosen mode has neither `href` nor `matched` (`app/duel/page.tsx:89-103`, `:120`).
`matched` marks a mode with no fixed URL: Play posts to `find-or-create` and
routes to the mode-specific room (`app/duel/page.tsx`). Pulse takes its stake and
leverage in-round.

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Global feed: static `PostCard` list from `app/lib/mockPosts.ts`, no backend |
| `app/exclusive/page.tsx` | Exclusive feed: gates on `app/lib/rank.ts` mock rank, locked teaser vs. unlocked list |
| `app/TabNav.tsx` | persistent Global/Exclusive/Duel tab switcher, active tab via `usePathname()` |
| `app/PostCard.tsx` | shared post rendering for both feed pages |
| `app/lib/mockPosts.ts` | hardcoded `GLOBAL_POSTS`/`EXCLUSIVE_POSTS` mock data, no persistence |
| `app/lib/rank.ts` | hardcoded mock rank/threshold stub gating `/exclusive` — no real rank system exists |
| `app/duel/page.tsx` | live lobby, BTC ticker/chart, mode switcher, quick-play controls, matchmaking + open-match list (moved from `app/page.tsx`) |
| `app/duel/[market]/match/[matchId]/page.tsx` | Quick Play room: 1s poll, prediction lock, countdown, result |
| `app/duel/[market]/pulse/[matchId]/page.tsx` | multiplayer Pulse room: position actions, live P&L, countdown, result |
| `app/ActiveMatchBar.tsx` | global bottom pill for a match running off-page; mounts `PulseMiniDock` while the active match is Pulse in `countdown` |
| `app/PulseMiniDock.tsx` | condensed Pulse trading controls (stake/leverage/long/short/close) shown from `ActiveMatchBar` on hover (desktop) or tap (touch), same `/api/match/[id]/action` calls as the full room |
| `app/lib/playerId.ts` | anonymous per-browser id in `localStorage` |
| `lib/match.ts` | `MatchView` role-scoping, presence, guarded settlement — shared by every `/api/match/*` route |
| `lib/spotPrice.ts` | Coinbase→Binance fallback chain + `productForMarket`; shared by `/api/price` and settlement |
| `app/api/match/*` | match lifecycle: find-or-create, view/heartbeat/settle, join, lock, leave, open list |
| `db/schema.ts` | `users` (Clerk id, balance) and `matches` (one row per networked round) |
| `app/duel/btc/pulse/page.tsx` | solo trading state, countdown, leveraged P&L, settlement, layout |
| `app/api/match/[id]/action/route.ts` | server-priced Pulse entry, close, and reverse actions |
| `app/duel/btc/pulse/trading.ts` | pure buy/sell portfolio accounting and full-position clamping — **no importers yet**, the page tracks a single leveraged position instead |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `MIN_WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, header shell, Clerk provider, metadata, Tailwind import, pre-paint theme script |
| `app/ThemeToggle.tsx` | header light/dark button, writes `data-theme` + `localStorage` |
| `app/theme.ts` | `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` — shared by layout (server) and toggle (client) |

## Theming

- Two themes, one token set. `:root` = dark (default), `[data-theme="light"]` redefines the same names (`app/globals.css:5-28`). No color literal belongs anywhere else — `PriceChart.tsx`, the match room and `pulse/page.tsx` use `var(--…)` in Tailwind arbitrary values, SVG presentation attributes and inline `style` alike.
- Resolution order: `localStorage.theme` → dark (`app/theme.ts:9`, mirrored by `readTheme()` in `app/ThemeToggle.tsx:7-14`). Both readers must stay in sync.
- `<html data-theme="dark" suppressHydrationWarning>` + the inline `<head>` script set the attribute during HTML parsing, before first paint (`app/layout.tsx:15-18`). `useLayoutEffect` in the toggle re-applies it after Strict Mode's dev remount clears `<html>`'s attributes.

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-10`) — divergence = visible seam between seeded and live chart segments.
- The chart's x-domain is a **fixed window ending now**, never the extent of the data (`app/PriceChart.tsx:101-108`). Deriving it from the data is what made the axis cram as points accumulated.
- `trim()` and `/api/history` must cut at the same `WINDOW_MS + SAMPLE_MS`, one sample wider than the window (`app/usePriceFeed.ts:16`, `app/api/history/route.ts:92`) — the chart interpolates its left-edge crossing from that extra point.
- Every API route: `export const dynamic = "force-dynamic"`. Price, history and match views also send `Cache-Control: no-store` (`app/api/price/route.ts:3`, `app/api/history/route.ts:3`, `app/api/match/[id]/route.ts:3`). Never cache a price or a round.
- Match state transitions are single guarded `UPDATE ... WHERE <guard> RETURNING *` statements, never read-then-write: `neon-http` has no transactions or row locks, so the guard *is* the lock (`app/api/match/[id]/lock/route.ts:43-58`). 0 rows back means someone else won — re-read, never retry blindly.
- The opponent's prediction is withheld server-side, not hidden in the client (`lib/match.ts:146`). Anything added to `MatchView` must be safe for the other player to read.
- `matches` timestamps are `timestamptz`; a bare `timestamp` column stores the writer's local time and silently breaks presence across timezones (`db/schema.ts:29-35`).
- All fetch paths degrade, never throw to the user: history → trades ∪ candles → `[]` (`app/api/history/route.ts:88-110`); price → Coinbase → Binance → 502 (`lib/spotPrice.ts:39-52`); match poll failure → keep polling, never eject the player (`app/duel/[market]/match/[matchId]/page.tsx:90-92`); settlement price outage → row stays in `countdown`, next poll retries (`lib/match.ts:71-73`).
- `PriceChart` holds only its time and price wheel zoom levels (`docs/chart.md` → Zoom), and otherwise stays a pure function of props — including its clock, which arrives as the `now` prop rather than a `Date.now()` read or an interval of its own (`app/duel/[market]/match/[matchId]/page.tsx:321-327`). Round/freeze logic belongs in the match room (`app/duel/[market]/match/[matchId]/page.tsx:128-137`), not the chart. Same for lock timestamps: the server stamps them, the room converts them off the server clock (`app/duel/[market]/match/[matchId]/page.tsx:52-56`), and the chart just draws whatever `PredictionLine.at` it gets.
- Color literals stay out of components: add a token to `app/globals.css` and define it in both blocks, or the toggle silently breaks in one theme.
- The duel lobby may read `usePriceFeed()` for live market display (`app/duel/page.tsx:139`), but settlement logic stays out of it — Quick Play settles on the server (`lib/match.ts:64`), Pulse in its own page.
- Pulse long/short reuse `--chart-up`/`--chart-down` (`app/duel/btc/pulse/page.tsx:16-17`), so a chart marker matches the control that placed it. P&L sign uses `--positive`/`--negative` (`:71`).

## Round data flow (Quick Play, sequence)

1. lobby Play → `POST /api/match/find-or-create` → guarded join or a new `open` row → `router.push` to the room
2. room mounts → `/api/history` seeds the series, socket opens, 100ms clock starts, 1s poll begins
3. each poll → one `UPDATE ... RETURNING *` that heartbeats *and* reads; server returns a role-scoped view + `serverNow`
4. both players lock → the 2nd lock's request flips `status` to `countdown` and stamps `roundStartAt`
5. client corrects for clock skew, counts down to `roundStartAt + timerSeconds` on a 200ms interval
6. first poll past the deadline settles server-side: `getSpotPrice()` → Pulse closes remaining positions and realizes P&L → diffs → winner, written under a `status='countdown'` guard
7. clients see `settled`, reveal both predictions, freeze the chart with the final point pinned to the deadline, and stop polling
8. “Play Again” returns to the lobby; a new match is a new row
