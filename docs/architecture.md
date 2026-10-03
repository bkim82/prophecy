# architecture

- Root header (`app/layout.tsx`) is brand | `Omens`/`Rooms`/`Arena`/`Wallet` nav | balance + avatar on desktop (see [feeds.md](feeds.md)), while `app/MobileBottomNav.tsx` supplies the dedicated phone navigation (`Omens`/`Rooms`/`Arena`/`Wallet`) at or below 768px and the compact mobile header keeps the brand, balance, and account control (theme switch lives in the avatar menu; signed out it sits beside Sign in). Routes: `/` (Global feed), `/rooms` (rank-gated group chat placeholder, `app/rooms/page.tsx`), `/duel` (the market lobby, moved from `app/page.tsx`), `/wallet` (wallet desk with injected EIP-1193 connection and holdings). Outside `/duel` and its games, the root shell shows the compact bottom-right plus chip `QuickTicketBar`; an active match takes that slot instead. `/exclusive` (rank-gated feed) still exists but is no longer linked from the header nav. Live ticker on `/duel` reads the client-side BTC feed.
- Multiplayer Pulse is server-authoritative: a `matches` row owns the round (`db/schema.ts:20`), `/api/match/*` routes own the transitions, clients poll. See [multiplayer-plan.md](multiplayer-plan.md).
- Practice is client-only: Pulse practice reuses `app/duel/btc/pulse/page.tsx?practice=1` without creating a match or reserving a wager. See [practice-mode.md](practice-mode.md).
- `/api/price` and `/api/history` remain stateless proxies to public exchange APIs. The price feed and chart stay client-side in every mode.

## Graph

```
app/layout.tsx (root shell: desktop header, compact mobile header, Clerk account controls)
  ├── app/TabNav.tsx (desktop Omens / Rooms / Arena / Wallet nav, icons + active pill)
  ├── app/BalancePill.tsx (ember balance button + balances dropdown)
  ├── app/AccountMenu.tsx (Clerk avatar menu with theme action; signed-out toggle + Sign in)
  ├── app/MobileBottomNav.tsx (phone Omens / Rooms / Arena / Wallet navigation)
  ├── app/page.tsx (Global feed: mock PostCard list, app/lib/mockPosts.ts)
  ├── app/rooms/page.tsx (Rooms: rank-gated group chat placeholder, app/lib/roomsMocks.ts)
  ├── app/exclusive/page.tsx (Exclusive feed: rank-gated via app/lib/rank.ts stub, unlinked from nav)
  ├── app/wallet/page.tsx (wallet desk: injected EIP-1193 connection, BTC long/short ticket)
  └── app/duel/page.tsx (live lobby: `Arena` h1 (`.feed-heading`) → Pulse/24h Portfolio `.feed-tabs.arena-mode-tabs` → market row (BTC/ETH left, `DailyCoin` "Daily · DOGE" chip right, selectable) → Pulse = `.pulse-stage` grid — ticker + MarketChart (app/MarketChart.tsx) left, call box (format/timer/Play) right, stacks <1000px; ≤640px: 220px plot, 24h stats behind `.market-stats-toggle`, call box reorders timer → Play first; match rows)
        └── usePriceFeed() → price, sampled series, status, now
app/duel/[market]/pulse/[matchId]/page.tsx (multiplayer Pulse positions, countdown, result)
app/duel/portfolio/page.tsx (solo 24h Portfolio: freely-tradeable spot/leverage positions on Base meme coins)
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
match room → POST /api/match/[id]/{action,leave}
/api/match/* → Neon Postgres (matches); settlement → lib/spotPrice.ts

portfolio room → GET /api/portfolio/session (3s poll: session/positions/history + lazy settle)
portfolio room → POST /api/portfolio/session {stake}, POST /api/portfolio/positions {...}, POST /api/portfolio/positions/[id]/close
/api/portfolio/* → Neon Postgres (portfolio_sessions, positions, portfolio_payouts); pricing → lib/basePrices.ts (DexScreener, Base chain)
/api/tokens/search, /api/tokens/prices → lib/basePrices.ts (token search + batch price quote); /api/tokens/trending, /api/tokens/history → lib/tokenHistory.ts (GeckoTerminal)

/api/history → api.exchange.coinbase.com (trades + candles, both, merged)
/api/price   → lib/spotPrice.ts → api.coinbase.com → api.binance.com fallback chain

duel/page.tsx Play controls → compact Practice action beside Play
```

Multiplayer BTC and ETH Pulse are wired up (same room, `/duel/[market]/pulse/[matchId]`; solo practice serves both via `app/duel/btc/pulse/page.tsx?practice=1&market=`). The 24h Portfolio (solo,
DB-backed — see [portfolio.md](portfolio.md)) is wired up identically across
all three market tabs, since it's asset-agnostic (token search picks the
coin, not the lobby's market switcher). DOGE's Pulse
is still a lobby-only placeholder — selectable in the mode switcher, which
locks the play panel when the chosen mode has neither `href` nor `matched`
(`app/duel/page.tsx:111-127`, `:163`). `matched` marks a mode that goes
through matchmaking with no fixed URL: Play posts to `find-or-create` and
routes to the mode-specific room. `href` marks a mode with a fixed,
non-matchmade URL, normally reached via a plain `Link` (`app/duel/page.tsx`
`playHref`) — the 24h Portfolio is the one exception: selecting it renders
`<PortfolioGame />` inline in the lobby instead (same as the retired
`Battle24h` widget did for 24h Reading), and its `href` only exists so
`/duel/portfolio` stays directly linkable as a standalone room. Pulse takes
its stake and leverage in-round; so does the 24h Portfolio.

## Modules

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Global feed: static `PostCard` list from `app/lib/mockPosts.ts`, no backend |
| `app/exclusive/page.tsx` | Exclusive feed: gates on `app/lib/rank.ts` mock rank, locked teaser vs. unlocked list; not linked from the header nav |
| `app/rooms/page.tsx` | Rooms placeholder: current-room heading, mock group chat with market-call/challenge chips, subtle rank ladder — see [rooms.md](rooms.md) |
| `app/TabNav.tsx` | desktop Omens/Rooms/Arena/Wallet header nav, active pill via `usePathname()` |
| `app/MobileBottomNav.tsx` | dedicated sub-768px bottom navigation for Omens, Rooms, Arena, and Wallet |
| `app/PostCard.tsx` | shared post rendering for both feed pages |
| `app/lib/mockPosts.ts` | hardcoded `GLOBAL_POSTS`/`EXCLUSIVE_POSTS` mock data, no persistence |
| `app/lib/rank.ts` | hardcoded mock rank/threshold stub gating `/exclusive` — no real rank system exists |
| `app/duel/page.tsx` | live lobby, BTC ticker/chart, mode switcher, Pulse controls, matchmaking + open-match list (moved from `app/page.tsx`) |
| `app/wallet/page.tsx` | wallet desk: injected EIP-1193 connection, wallet status, and BTC long/short ticket |
| `app/lib/wallet.ts` | injected EIP-1193 provider helpers, chain labels, ETH formatting, and address shortening |
| `app/duel/[market]/pulse/[matchId]/page.tsx` | multiplayer Pulse room: position actions, live P&L, countdown, result |
| `app/duel/portfolio/PortfolioGame.tsx` + `SessionHeader.tsx`/`TokenSearch.tsx`/`TradeTicket.tsx`/`OpenPositions.tsx`/`ClosedPositions.tsx` | 24h Portfolio game: session start, live-priced token search, spot/leverage trade ticket, open/closed position lists — embedded inline in `app/duel/page.tsx`'s mode switcher and wrapped standalone by `app/duel/portfolio/page.tsx` |
| `lib/portfolioRules.ts` | pure 24h Portfolio math/constants, no DB import — client-safe, mirrors `lib/pulse.ts` |
| `lib/basePrices.ts` | DexScreener wrapper: Base-only token search + batched/cached price lookup + token meta (logo, 24h change), shared by `/api/tokens/*` and portfolio settlement |
| `lib/tokenHistory.ts` | GeckoTerminal wrapper: 24h hourly history + trending Base coins, budgeted under its ~30 req/min limit |
| `lib/portfolio.ts` | 24h Portfolio DB layer built on `portfolioRules.ts`: session start, guarded position open/close, lazy settlement, payout ledger |
| `app/api/portfolio/session/route.ts` | `GET` current session/positions/history (settles a past-due session first), `POST` starts a session |
| `app/api/portfolio/positions/route.ts`, `app/api/portfolio/positions/[id]/close/route.ts` | open/close a position at the live price |
| `app/api/tokens/search/route.ts`, `app/api/tokens/prices/route.ts` | thin wrappers over `lib/basePrices.ts` |
| `app/api/tokens/trending/route.ts`, `app/api/tokens/history/route.ts` | thin wrappers over `lib/tokenHistory.ts` |
| `app/ActiveMatchBar.tsx` | global bottom pill for a match running off-page; mounts `PulseMiniDock` while the active match is Pulse in `countdown` |
| `app/QuickTicketBar.tsx` | idle-state global bottom tab; expands the shared `WalletDesk` ticket upward when no match or queue is active; hidden on `/duel` and all `/duel/*` |
| `app/PulseMiniDock.tsx` | condensed Pulse trading controls (stake/leverage/long/short/close) shown from `ActiveMatchBar` on hover (desktop) or tap (touch), same `/api/match/[id]/action` calls as the full room |
| `app/lib/playerId.ts` | anonymous per-browser id in `localStorage` |
| `lib/match.ts` | `MatchView` role-scoping, presence, guarded settlement — shared by every `/api/match/*` route |
| `lib/spotPrice.ts` | Coinbase→Binance fallback chain + `productForMarket`; shared by `/api/price` and settlement |
| `app/api/match/*` | match lifecycle: find-or-create, view/heartbeat/settle, join, action, leave, open list |
| `db/schema.ts` | `users` (Clerk id, balance), `matches` (one row per networked round), `portfolio_sessions`/`positions`/`portfolio_payouts` (one row per 24h Portfolio session, its independent spot/leverage position lots, and each session's idempotent payout) |
| `app/duel/btc/pulse/page.tsx` | solo trading state, countdown, leveraged P&L, settlement, layout |
| `app/api/match/[id]/action/route.ts` | server-priced Pulse entry, close, and reverse actions |
| `app/duel/btc/pulse/trading.ts` | pure buy/sell portfolio accounting and full-position clamping — **no importers yet**, the page tracks a single leveraged position instead |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `MIN_WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, header shell, Clerk provider, metadata, Tailwind import, pre-paint theme script |
| `app/ThemeToggle.tsx` | `useTheme()` hook (writes `data-theme` + `localStorage`), Sun/Moon icons, signed-out header toggle; signed-in toggle is in `app/AccountMenu.tsx` |
| `app/theme.ts` | `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` — shared by layout (server) and toggle (client) |

## Theming

- Two themes, one token set. `:root` = dark (default), `[data-theme="light"]` redefines the same names (`app/globals.css:5-28`). No color literal belongs anywhere else — `PriceChart.tsx`, the match room and `pulse/page.tsx` use `var(--…)` in Tailwind arbitrary values, SVG presentation attributes and inline `style` alike.
- Resolution order: `localStorage.theme` → dark (`app/theme.ts:9`, mirrored by `readTheme()` in `app/ThemeToggle.tsx:7-14`). Both readers must stay in sync.
- `<html data-theme="dark" suppressHydrationWarning>` + the inline `<head>` script set the attribute during HTML parsing, before first paint (`app/layout.tsx:29-37`). `useLayoutEffect` in the toggle re-applies it after Strict Mode's dev remount clears `<html>`'s attributes.

## Invariants (do not violate silently)

- Websocket stays client-side (no key needed, no relay hop). Do not move to server without reason.
- `feedConfig.ts` constants must stay shared, not duplicated (`app/feedConfig.ts:3-10`) — divergence = visible seam between seeded and live chart segments.
- The chart's x-domain is a **fixed window ending now**, never the extent of the data (`app/PriceChart.tsx:101-108`). Deriving it from the data is what made the axis cram as points accumulated.
- `trim()` and `/api/history` must cut at the same `WINDOW_MS + SAMPLE_MS`, one sample wider than the window (`app/usePriceFeed.ts:16`, `app/api/history/route.ts:92`) — the chart interpolates its left-edge crossing from that extra point.
- Every API route: `export const dynamic = "force-dynamic"`. Price, history, match views and portfolio state also send `Cache-Control: no-store` (`app/api/price/route.ts:3`, `app/api/history/route.ts:3`, `app/api/match/[id]/route.ts:3`, `app/api/portfolio/session/route.ts`, `app/api/tokens/*`). Never cache a price or a round at the HTTP layer — this is distinct from the intentional in-memory TTL caches in `lib/basePrices.ts` and `lib/tokenHistory.ts`, which exist purely to stay under DexScreener's/GeckoTerminal's rate limits and are never surfaced as an HTTP cache header.
- Match state transitions are single guarded `UPDATE ... WHERE <guard> RETURNING *` statements, never read-then-write: `neon-http` has no transactions or row locks, so the guard *is* the lock (`app/api/match/[id]/action/route.ts:89`). 0 rows back means someone else won — re-read, never retry blindly.
- The opponent's positions are withheld server-side until `countdown`, not hidden in the client (`lib/match.ts:182-187`). Anything added to `MatchView` must be safe for the other player to read.
- `matches` timestamps are `timestamptz`; a bare `timestamp` column stores the writer's local time and silently breaks presence across timezones (`db/schema.ts:29-35`).
- All fetch paths degrade, never throw to the user: history → trades ∪ candles → `[]` (`app/api/history/route.ts:88-110`); price → Coinbase → Binance → 502 (`lib/spotPrice.ts:39-52`); match poll failure → keep polling, never eject the player (`app/duel/[market]/pulse/[matchId]/page.tsx:111-114`); settlement price outage → row stays in `countdown`, next poll retries (`lib/match.ts:103-106`).
- `PriceChart` holds only its time and price wheel zoom levels (`docs/chart.md` → Zoom), and otherwise stays a pure function of props — including its clock, which arrives as the `now` prop rather than a `Date.now()` read or an interval of its own (`app/duel/[market]/pulse/[matchId]/page.tsx:201`). Round/freeze logic belongs in the match room (`app/duel/[market]/pulse/[matchId]/page.tsx:132`), not the chart. Same for server timestamps: the room converts them off the server clock (`app/duel/[market]/pulse/[matchId]/page.tsx:55-62`, `:121`), and the chart just draws whatever `roundStart`/`trades` it gets.
- Color literals stay out of components: add a token to `app/globals.css` and define it in both blocks, or the toggle silently breaks in one theme.
- The arena lobby may read `usePriceFeed()` for live market display (`app/duel/page.tsx:139`), but settlement logic stays out of it — multiplayer Pulse settles on the server (`lib/match.ts:98`), solo Pulse in its own page.
- Pulse long/short reuse `--chart-up`/`--chart-down` (`app/duel/btc/pulse/page.tsx:16-17`), so a chart marker matches the control that placed it. P&L sign uses `--positive`/`--negative` (`:71`).

## Round data flow (multiplayer Pulse, sequence)

1. lobby Play → `POST /api/match/find-or-create` → guarded join or a new `open` row → `router.push` to the room
2. room mounts → `/api/history` seeds the series, socket opens, 100ms clock starts, 1s poll begins
3. each poll → one `UPDATE ... RETURNING *` that heartbeats *and* reads; server returns a role-scoped view + `serverNow`
4. the first poll past the 5s pre-round deadline flips `status` to `countdown` and stamps `roundStartAt` (`lib/match.ts:80`)
5. client corrects for clock skew, counts down to `roundStartAt + timerSeconds` on a 200ms interval
6. first poll past the deadline settles server-side: `getSpotPrice()` → closes remaining positions and realizes P&L → higher P&L wins, written under a `status='countdown'` guard
7. clients see `settled`, show both P&Ls, freeze the chart with the final point pinned to the deadline, and stop polling
8. “Play Again” returns to the lobby; a new match is a new row
