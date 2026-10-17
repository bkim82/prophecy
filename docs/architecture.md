# architecture

- Root header (`app/layout.tsx`) is brand | `Omens`/`Arena`/`Sanctum`/`Wallet` nav | balance + avatar on desktop (see [feeds.md](feeds.md)); `/wallet` uses the signed-in canonical CDP Base smart account, not an external wallet connection ([wallet.md](wallet.md)).
- Multiplayer Pulse is server-authoritative: a `matches` row owns the round (`db/schema.ts:20`), `/api/match/*` routes own the transitions, clients poll. See [multiplayer-plan.md](multiplayer-plan.md).
- Practice is client-only: Pulse practice reuses `app/duel/btc/pulse/page.tsx?practice=1` without creating a match or reserving a wager. See [practice-mode.md](practice-mode.md).
- `/api/price` and `/api/history` remain stateless proxies to public exchange APIs. The price feed and chart stay client-side in every mode.

## Graph

```
app/layout.tsx (root shell: desktop header, compact mobile header, feature-gated auth provider)
  ├── app/TabNav.tsx (desktop Omens / Arena / Sanctum / Wallet nav, icons + active pill)
  ├── app/BalancePill.tsx (ember balance button + balances dropdown)
  ├── app/AccountMenu.tsx (provider-neutral avatar menu + Profile/sign-out; signed-out Sign in)
  ├── app/MobileBottomNav.tsx (phone Omens / Arena / Sanctum / Wallet navigation)
  ├── app/page.tsx (Global feed: mock PostCard list, app/lib/mockPosts.ts)
  ├── app/sanctum/page.tsx (Sanctum: Oracle Room live Pulse + feed + chat, app/lib/roomsMocks.ts)
  ├── app/exclusive/page.tsx (Exclusive feed: rank-gated via app/lib/rank.ts stub, unlinked from nav)
  ├── app/wallet/page.tsx (canonical embedded Base wallet, Portfolio/Advanced tabs — docs/wallet.md)
  └── app/duel/page.tsx (live lobby: screen-reader-only `Arena` h1 → Pulse/24h Portfolio `.feed-tabs.arena-mode-tabs` → market row (BTC/ETH left, `DailyCoin` "Daily · Ð DOGE" chip right (market symbol from `MARKETS`), selectable) → Pulse = `.pulse-stage` grid — ticker + MarketChart (app/MarketChart.tsx) left, call box (format/timer/Play) right, stacks <1000px; ≤640px: 220px plot, 24h stats behind `.market-stats-toggle`, call box reorders timer → Play first; match rows)
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
duel/page.tsx Recent results → GET /api/match/recent (once per mount, signed in)
match room → GET /api/match/[id] (1s poll: view + heartbeat + lazy settle)
match room → POST /api/match/[id]/{action,leave}
/api/match/* → Neon Postgres (matches); settlement → lib/spotPrice.ts

portfolio room → GET /api/portfolio/session (3s poll: session/positions/history + lazy settle)
portfolio room → POST /api/portfolio/session {stake}, POST /api/portfolio/positions {...}, POST /api/portfolio/positions/[id]/close
/api/portfolio/* → Neon Postgres (portfolio_sessions, positions, portfolio_payouts); pricing → lib/basePrices.ts (DexScreener, Base chain)
/profile (server) → lib/viewer.ts provider display/join-date bridge + lib/profile.ts (profiles) + lib/match.ts (settled matches); Edit profile → saveProfile server action (app/profile/actions.ts) → profiles upsert; feature-gated app-owned avatar + banner bytes → owner-only GET /api/profile/{avatar,banner}; Clerk photo remains the default-path fallback until cutover
/api/session POST → same-origin/Bearer validation → CDP validateAccessToken → canonical smart account → atomic users upsert + old-session revoke + app_sessions insert; DELETE → guarded current-session revoke; DELETE /api/session/all → current-token authentication + atomic all-session revoke; both clear the cookie (feature-gated, inactive by default)
getViewer() → Clerk by default; when EMBEDDED_WALLET_AUTH_ENABLED=true, hashed __Host-prophecy_session lookup → users canonical wallet, with no Clerk fallback
/api/wallet/intents → typed send validation → transaction_intents; confirm/submit/broadcast → guarded state transitions + sponsored-spend counters
/api/wallet/reconcile → CDP user-operation status → included/reverted/dropped; /api/wallet/activity merges local durable rows with confirmed Alchemy activity
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
| `app/sanctum/page.tsx` | Oracle Room: coin toggle, live chart + trading dock, simulated room trade feed with coin filters, mini chat — see [sanctum.md](sanctum.md) |
| `app/TabNav.tsx` | desktop Omens/Arena/Sanctum/Wallet header nav, active pill via `usePathname()` |
| `app/MobileBottomNav.tsx` | dedicated sub-768px bottom navigation for Omens, Arena, Sanctum, and Wallet |
| `app/MobileChromeAutoHide.tsx` | sub-768px scroll-direction auto-hide for the header + bottom nav via `html[data-chrome]` ([feeds.md](feeds.md)) |
| `app/PostCard.tsx` | shared post rendering for both feed pages |
| `app/lib/mockPosts.ts` | hardcoded `GLOBAL_POSTS`/`EXCLUSIVE_POSTS` mock data, no persistence |
| `app/lib/rank.ts` | hardcoded mock rank/threshold stub gating `/exclusive` — no real rank system exists |
| `app/duel/page.tsx` | live lobby, BTC ticker/chart, mode switcher, Pulse controls, matchmaking + open-match list, your Recent results (moved from `app/page.tsx`) |
| `app/wallet/page.tsx` + `app/wallet/*` | wallet dashboard: Portfolio (balance chip, coin list/detail), Activity (local intents + confirmed transfers), Advanced tabs; Deposit/Send/Swap sheets — see [wallet.md](wallet.md) |
| `app/lib/useWalletConnection.ts` | canonical smart-account identity + public native-balance polling from the validated auth context |
| `app/lib/embeddedWallet/{intents,sign,tokens}.ts` | exact raw-unit policies/call decoding, sole CDP signing boundary, curated Base assets |
| `lib/transactionIntents.ts` | durable intent state machine, idempotency, spend counters, audit events, CDP receipt reconciliation |
| `app/api/wallet/*` | public Base reads plus authenticated intent/confirm/submit/broadcast/reconcile mutations; metered reads are IP-limited after embedded-auth activation |
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
| `db/schema.ts` | `users` (transitioning Clerk/CDP id, Embers balance, nullable-until-reset canonical wallet fields), `app_sessions` (hashed opaque sessions), `request_rate_limits` (keyed fixed-window claims), `matches` (one row per networked round), `portfolio_sessions`/`positions`/`portfolio_payouts`, `profiles`, and `challenges` (`db/schema.ts:14-236`) — see [profiles.md](profiles.md) and [embedded-wallet-plan.md](embedded-wallet-plan.md) |
| `app/api/session/**`, `lib/appSession.ts`, `app/lib/authSession.ts`, `lib/cdp.ts`, `lib/embeddedWalletAccount.ts`, `lib/requestSecurity.ts` | Feature-gated CDP access-token exchange and application-session lifecycle: exact smart-account/owner selection, Base assertion, keyed hashes, atomic rotation/current/all-session revocation, idle/absolute expiry, same-origin empty-JSON checks, hardened cookie handling, and database-backed limits; inactive until schema and credentialed gates pass |
| `lib/profile.ts`, `app/profile/actions.ts`, `app/lib/profileImage.ts`, `app/api/profile/{avatar,banner}/route.ts` | own-profile storage: metadata read (no image bytes), atomic text/avatar/banner upsert, pins; signature/MIME/size/dimension validation; owner-only image routes with safe content headers |
| `app/duel/btc/pulse/page.tsx` | solo trading state, countdown, leveraged P&L, settlement, layout |
| `app/api/match/[id]/action/route.ts` | server-priced Pulse entry, close, and reverse actions |
| `app/duel/btc/pulse/trading.ts` | pure buy/sell portfolio accounting and full-position clamping — **no importers yet**, the page tracks a single leveraged position instead |
| `app/usePriceFeed.ts` | websocket, history seed, reconnection, sampled series |
| `app/PriceChart.tsx` | pure props→SVG, no fetch, no state |
| `app/feedConfig.ts` | `WINDOW_MS`, `MIN_WINDOW_MS`, `SAMPLE_MS` + axis interval defaults — shared by hook, seed route, chart |
| `app/api/price/route.ts` | REST spot price, 2-source fallback chain |
| `app/api/history/route.ts` | chart seed for the full window: trades + candle backfill, merged |
| `app/layout.tsx` | root HTML, header shell, server-selected `AuthProvider` (Clerk default; CDP only behind `EMBEDDED_WALLET_AUTH_ENABLED=true`), metadata, Tailwind import, pre-paint theme script |
| `app/ThemeToggle.tsx` | `useTheme()` hook (`theme`/`setTheme`, writes `data-theme` + `localStorage`, `MutationObserver` keeps header copies in sync), `ThemeToggle` header picker (swatch → Obsidian/Navy/Moonstone menu) |
| `app/theme.ts` | `Theme`, `DEFAULT_THEME` (`obsidian`), `THEMES` (picker copy), `normalizeTheme()`, `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` — shared by layout (server) and toggle (client) |

## Theming

- Three themes, one token set. `:root` = Navy, `[data-theme="light"]` (Moonstone: pearl/white surfaces, white header, violet brand) redefines the same names (`app/globals.css:31`) plus a faint violet body glow (`:71`), `[data-theme="obsidian"]` (default) overrides only what differs from Navy (`app/globals.css:55`) plus a few obsidian-scoped rules right after it (active nav pill; `+ Trade` violet outline, shared with Moonstone). No color literal belongs anywhere else — `PriceChart.tsx`, the match room and `pulse/page.tsx` use `var(--…)` in Tailwind arbitrary values, SVG presentation attributes and inline `style` alike.
- Resolution order: `localStorage.theme` (`navy`/`light`) → `obsidian`; legacy stored `"dark"` maps to `obsidian` (`normalizeTheme()` `app/theme.ts:15`, inlined in `THEME_INIT_SCRIPT` `app/theme.ts:23`). Both must stay in sync.
- `<html data-theme={DEFAULT_THEME} suppressHydrationWarning>` + the inline `<head>` script set the attribute during HTML parsing, before first paint (`app/layout.tsx:30-37`). `useLayoutEffect` in the toggle re-applies it after Strict Mode's dev remount clears `<html>`'s attributes.

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
- Color literals stay out of components: add a token to `app/globals.css` and define it in the `:root` and light blocks (and obsidian if Navy's value doesn't fit), or the toggle silently breaks in one theme.
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
