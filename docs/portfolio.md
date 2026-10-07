# 24h Portfolio

Status: built. Solo, server-authoritative, DB-backed — like the retired 24h
Reading, there is no opponent and no `matches` row. Unlike Reading, this is a
genuine portfolio: any number of open/close trades across any number of Base
meme coins during one rolling 24h session, not a single locked-in call.

## Shape

- A session (`portfolio_sessions` row, `db/schema.ts`) starts when the user picks a stake: `POST /api/portfolio/session {stake}` reserves the stake from `users.balance` and inserts a row with `endAt = startAt + 24h` (`lib/portfolioRules.ts` `PORTFOLIO_SESSION_MS`/`sessionEndAt`), an absolute instant computed once and never recomputed later. Only **one active session per user** at a time, enforced by a partial unique index (`db/schema.ts` `portfolio_sessions_one_active_per_user`) so starting a session is a single guarded INSERT, never a read-then-insert.
- Within the session, the user opens any number of independent positions (`positions` rows) against any Base-chain token found via search — no fixed asset list. Two shapes, discriminated by `kind`:
  - **Spot** (`kind: "spot"`): buy-to-open, ownership-based — `qty = amount / entryPrice`, valued mark-to-market. Selling closes the whole position (no partial sells).
  - **Leverage** (`kind: "leverage"`): directional wager like the retired Reading call — `side: "long"|"short"`, fixed chips `1×/2×/3×/5×` (`PORTFOLIO_LEVERAGE_OPTIONS`, far below Reading's `1×–20×` since meme coins move much harder intraday than BTC/ETH).
- No averaging, no partial closes: every buy/long/short is its own lot (same all-or-nothing shape as `lib/pulse.ts PulsePosition`); closing always closes it entirely.
- P&L: spot floors a loss at `-(qty × entryPrice)`, leverage floors at `-committedCash` (`lib/portfolioRules.ts` `spotPnl`/`leveragePnl`, dispatched via `positionPnl`) — same stop-out shape Reading/Pulse both use.
- The session itself always runs the full 24h — there's no manual early end. At `endAt`, any still-open positions are force-closed at market and the session pays out.
- Auth-gated (Clerk `userId`), same as the retired Reading.

## Module split

- `lib/portfolioRules.ts` — pure math and constants, **no DB import**. Client-safe (mirrors `lib/pulse.ts`/the retired `lib/readingRules.ts`); the room imports it for the leverage chip list and position kind guards.
- `lib/basePrices.ts` — DexScreener wrapper: `searchTokens(query)` (Base-only, name/ticker or `0x` address, ~10s cache) and `getTokenPrices(addresses)` (batched ~30/request, ~4s cache, concurrent-request dedupe). Never throws — serves stale cached prices on a fetch failure. See its module comment for the rate-limit math (DexScreener's ~60 req/min budget). Every fetch also refreshes a per-address meta cache (logo `imageUrl`, `change24h`, `marketCapUsd`, most-liquid `pairAddress`, plus that pool's `volume24hUsd`/`pairCreatedAt`/`dexId`/`quoteSymbol` for the detail panel's context); `getTokenMetas` (~10 min TTL, for rows that don't need a live price) and `getTokenSummaries` (price + meta) read it.
- `lib/tokenHistory.ts` — GeckoTerminal wrapper (~30 req/min upstream, kept under a 20/min rolling budget): `getTokenHistories` (closes via each token's `pairAddress` per `HISTORY_PERIODS` — `1h` 60×1m, `24h` 24×1h (default), `7d` 42×4h, `30d` 30×1d — cached 1m/5m/15m/1h per period; `cachedOnly` never fetches), `getTrendingTokens` (up to 20 trending Base pools minus WETH/stables, ~3 min cache, priced through `getTokenSummaries`, GeckoTerminal logo only as a fallback) and `getNewTokens` (GeckoTerminal `new_pools`, same filtering/cache, only pools with ≥$10k liquidity, newest first). Over budget/429/200-with-no-`data` → last cached value, or the address in `retry` (`fetchHistory` returns `null`; a real empty pool returns `"none"`).
- Logos are looked up live, not stored on `positions` — a token with no DexScreener profile renders a lettered fallback (`app/duel/portfolio/ui.tsx` `CoinImage`).
- `lib/portfolio.ts` — DB layer: session start, position open/close (both single guarded statements, no read-then-write), lazy settlement, and `portfolioView` (attaches live mark price/unrealized P&L per position + session equity). Re-exports everything from `portfolioRules.ts`.

## Settlement (lazy, like `settleIfDue`)

`settlePortfolioIfDue(userId)` (`lib/portfolio.ts`) runs on every
`GET /api/portfolio/session`: if the user's active session is past `endAt`,
it fetches live prices for every open position and force-closes each one
(`closeReason: "session_end"`) via the same guarded-CTE `closePosition` a
manual close uses — zero rows back means a concurrent poll already closed it.
Once no open positions remain, the session flips to `settled` under a
`status='active'` guard and is paid out through an idempotent ledger
(`portfolio_payouts` table, `creditPortfolioPayout`), mirroring
`lib/balance.ts creditPayout`. A price-source outage just leaves positions
open for the next poll to retry.

## Routes

| Route | Does |
| --- | --- |
| `GET /api/portfolio/session` | settles a past-due session first, then returns the current session (with live equity/available cash), its open positions with live mark price + unrealized P&L, this session's closed positions, and recent settled-session history; every position row also carries `imageUrl`/`change24h` from `getTokenMetas` |
| `POST /api/portfolio/session` `{stake}` | starts a new session; 409 if one is already active or the stake exceeds balance |
| `POST /api/portfolio/positions` `{kind, tokenAddress, tokenSymbol, tokenName, side?, leverage?, amount}` | opens a position at the live price; 402 insufficient available cash, 409 no active session |
| `POST /api/portfolio/positions/[id]/close` | closes one open position at the live price; 409 if already closed |
| `GET /api/tokens/search?q=` | Base-only token search (name, ticker or contract address), thin wrapper over `lib/basePrices.ts searchTokens` |
| `POST /api/tokens/prices` `{addresses}` | live mark `prices` plus `tokens` (price + logo/24h change/market cap) via `getTokenSummaries` |
| `GET /api/tokens/trending` | trending Base coins for the explorer's Trending filter (`lib/tokenHistory.ts getTrendingTokens`) |
| `GET /api/tokens/new` | newly created Base pools with real liquidity for the explorer's New filter (`getNewTokens`); fetched only once New/All is opened |
| `POST /api/tokens/history` `{addresses, cachedOnly?, period?}` | closes per address for the token detail chart (`getTokenHistories`); `period` `1h`/`24h`/`7d`/`30d`, default `24h`; 400 on an unknown period; addresses with no history are omitted; `retry` lists addresses that couldn't be fetched right now (budget/rate limit/network); `retryAfterMs` = ms until the 20/min budget frees a slot (null when the cause was upstream) |

## Client

- `app/duel/portfolio/PortfolioGame.tsx` — the whole game as one embeddable component: polls `GET /api/portfolio/session` every 3s; a local 1s ticker drives the "time left" countdown off `serverNow`-corrected `endAt`, same skew-correction pattern the match room and the retired Reading room used. Dispatches `balance-updated` (the convention `app/BalancePill.tsx` listens for) when a session settles or a position closes.
- `app/duel/portfolio/page.tsx` — thin standalone-room wrapper around `PortfolioGame` (back link, page title, max-width container), reachable directly at `/duel/portfolio`.
- `app/duel/page.tsx` mode switcher: selecting `battle-24h` renders `<PortfolioGame />` inline in the lobby (same pattern the retired `Battle24h` widget used for 24h Reading) — no navigation away from `/duel` is needed to play. The mode switcher sits above the market row, and the market row (`market-nav`) and price chart (`market-overview`) only render in `pulse` mode. `href: "/duel/portfolio"` is kept on the mode entry only so the standalone room stays directly linkable/bookmarkable.
- Layout (`PortfolioGame.tsx`): compact `SessionStrip` on top, then three columns at `lg` — Explore tokens 28% · Selected token 44% · Your portfolio 28%, all one height: the token profile sets it (`lg:min-h-[900px]`, 320px chart) and the side columns fill it absolutely and scroll inside — then Allocation + Closed positions, then session history. Below `lg`: Explore / Portfolio tabs; tapping a token opens the detail screen (back button returns to the list). The first trending token is auto-selected so the detail column isn't empty (`onAutoSelect`, never switches the mobile view).
- `app/duel/portfolio/SessionStrip.tsx` — one-line strip: live dot, equity + change vs. stake, Started / Realized / Open P&L, countdown with a 24h ring (end time in the tooltip). `BuyingPower` (available, % deployed bar, committed) heads the portfolio column. `StartPanel` (stake picker) when no session; skeleton until the first poll lands.
- `app/duel/portfolio/TokenExplorer.tsx` — always-visible search (name/ticker/0x, debounced `300ms`), Trending · Watchlist · New · All filters, sort (Rank / 24h volume / Market cap / 24h gainers / 24h losers). Rows: logo, name, ticker, `Owned` badge, MC · Liq, live price, labeled 24h change with ▲/▼, hover-revealed watchlist star. Listed prices refresh every 20s in place; the **order is frozen** per filter/sort/search view — new rows only append — and "Refresh rankings" refetches the lists and re-sorts (dot shows when the frozen order differs from a fresh sort or is >3 min old). One `.pf-select-indicator` slides to the selected row. Arrow keys move between search and rows. Its four endpoint paths (`trending`/`new`/`search`/`prices`) are an `endpoints` prop, defaulting to the Clerk-gated `/api/tokens/*` routes below — the wallet's Advanced tab (`docs/wallet.md`) reuses this same component against the no-auth `/api/wallet/*` mirrors instead of forking it.
- `app/duel/portfolio/watchlist.ts` — `useWatchlist()`, a `useSyncExternalStore` over `localStorage["pf-watchlist-v1"]` (per-browser, cross-tab synced); stores address/symbol/name/logo only.
- `app/duel/portfolio/TokenDetail.tsx` — selected token: logo, name, Base badge, copyable contract address, watchlist star, `LivePrice` refreshed every 5s via `/api/tokens/prices`, 24h change (+ the chart period's change), chart with 1H/24H/7D/30D drawn by the duel lobby `MarketChart` (`app/MarketChart.tsx`, with `windowMs`/`tickMs`/`formatPrice`/`formatTime`/`smooth={false}`; closes spread evenly over the period, live quote as the head; neutral line via `.pf-coin-chart`: white on dark, `--text` on light), Market cap / Liquidity / 24h volume / Pool age, a factual blurb generated only from that data (`describe`), and the data source + quote age. Notes open positions you already hold in it. Crossfades (`.pf-crossfade`) on selection change.
- `app/duel/portfolio/OrderForm.tsx` — Spot / Leverage tabs (leverage adds Long/Short + `PORTFOLIO_LEVERAGE_OPTIONS` chips), one amount field with 10/25/50/100/Max presets (no summary rows), one submit (`Buy XDP` / `Long XDP 3×`) that compresses on press and shows "Placing order…" until the server answers; disabled label says why. No sell mode — spot lots are sold from their position card. Mobile: valid-order button sticks above the bottom nav (`.pf-sticky-submit`) and drops with it when the nav auto-hides.
- New positions appear only after `POST /api/portfolio/positions` succeeds: `PortfolioGame.openPosition` inserts the confirmed row (marked at its fill price), polls immediately, and flags it `freshId` for ~2.2s so its card slides in and its border highlights once (`.pf-position-enter`). The fill message is neutral ("Order filled · …"), not a win state.
- `app/duel/portfolio/OpenPositions.tsx` — one card per position, newest first: colored edge (long brand / short negative / spot `--spot`), unrealized P&L as the lead figure, size/entry/current/return, opened-ago, Sell (spot) / Close (leverage).
- `app/duel/portfolio/PortfolioSummary.tsx` — segmented allocation bar by coin + available (segments resize over 300ms, `.pf-bar-segment`), total exposure (committed × leverage), open P&L.
- `app/duel/portfolio/ClosedPositions.tsx` — this session's closed positions (first 4, expandable). `SessionHistory.tsx` — settled sessions: latest 3, "View session history" expands the fetched list; each row expands to start/settle/stake/final.
- `app/duel/portfolio/ui.tsx` — formatters (`usd` uses subscript-zero notation for sub-$0.0001 prices), `CoinImage`, `useFlash` (P&L tint on change), `LivePrice` (only changed digits tint, tabular width), `Change` (▲/▼ + signed %), `StarButton` (spring pop on fill), `useTokenHistory(addresses, cachedOnly, period)` (page-wide client cache keyed by period, 5 min refresh; `retry` misses re-asked at the server's `retryAfterMs` + up to 1s jitter, else 15s, on a 1s due-check tick; `status()` is `none` only for genuinely empty history, so the detail chart shows its loading beam instead of "No history" while upstream is throttled). Styles: `.pf-*` + `--ember`/`--spot` tokens in `app/globals.css`; `.portfolio-game` reverts the global `button, input { font: inherit }` so Tailwind text utilities apply. All `.pf-*` motion is disabled under `prefers-reduced-motion`. No sound.

## Known non-behaviors

- No cross-session leaderboard or full position history browsing beyond the current session + a short list of recent settled sessions (`docs/roadmap.md`).
- Base only — no other chain's meme coins.
- Watchlist is per-browser `localStorage`, not tied to the Clerk account — it doesn't follow the user across devices.
- `positions`/`portfolio_sessions` rows accumulate with no cleanup, same as `matches`/the retired `readings`.
