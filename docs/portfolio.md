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
- `lib/basePrices.ts` — DexScreener wrapper: `searchTokens(query)` (Base-only, name/ticker or `0x` address, ~10s cache) and `getTokenPrices(addresses)` (batched ~30/request, ~4s cache, concurrent-request dedupe). Never throws — serves stale cached prices on a fetch failure. See its module comment for the rate-limit math (DexScreener's ~60 req/min budget). Every fetch also refreshes a per-address meta cache (logo `imageUrl`, `change24h`, `marketCapUsd`, most-liquid `pairAddress`); `getTokenMetas` (~10 min TTL, for rows that don't need a live price) and `getTokenSummaries` (price + meta) read it.
- `lib/tokenHistory.ts` — GeckoTerminal wrapper (~30 req/min upstream, kept under a 20/min rolling budget): `getTokenHistories` (24 hourly closes via each token's `pairAddress`, ~5 min cache; `cachedOnly` never fetches) and `getTrendingTokens` (trending Base pools minus WETH/stables, ~3 min cache, priced through `getTokenSummaries`, GeckoTerminal logo only as a fallback). Over budget/429 → last cached value or nothing.
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
| `GET /api/tokens/trending` | trending Base coins for the picker's pre-search row (`lib/tokenHistory.ts getTrendingTokens`) |
| `POST /api/tokens/history` `{addresses, cachedOnly?}` | 24h hourly closes per address for sparklines/charts (`getTokenHistories`); addresses with no history are omitted |

## Client

- `app/duel/portfolio/PortfolioGame.tsx` — the whole game as one embeddable component: polls `GET /api/portfolio/session` every 3s; a local 1s ticker drives the "time left" countdown off `serverNow`-corrected `endAt`, same skew-correction pattern the match room and the retired Reading room used. Dispatches `balance-updated` (the convention `app/BalancePill.tsx` listens for) when a session settles or a position closes.
- `app/duel/portfolio/page.tsx` — thin standalone-room wrapper around `PortfolioGame` (back link, page title, max-width container), reachable directly at `/duel/portfolio`.
- `app/duel/page.tsx` mode switcher: selecting `battle-24h` renders `<PortfolioGame />` inline in the lobby (same pattern the retired `Battle24h` widget used for 24h Reading) — no navigation away from `/duel` is needed to play. `href: "/duel/portfolio"` is kept on the mode entry only so the standalone room stays directly linkable/bookmarkable.
- `app/duel/portfolio/SessionHero.tsx` — one compact hero: equity + change vs. stake, a buying-power bar (available vs. committed), countdown with end time and a 24h ring, then Starting / Realized P&L / Open P&L. `StartPanel` (stake picker) when no session; skeleton until the first poll lands.
- `app/duel/portfolio/CoinPicker.tsx` — search combobox (debounced `300ms`, arrow/enter/escape) with logo, price, 24h change, MC/liquidity and a cached-only sparkline per result; before searching, a horizontal row of this session's coins then trending coins.
- `app/duel/portfolio/TradeTicket.tsx` — selected-coin header (logo, Base badge, live price refreshed every 5s via `/api/tokens/prices`, 24h chart), Spot (Buy/Sell — Sell lists your open spot lots of that coin and closes them) vs. Leverage (Long/Short, `PORTFOLIO_LEVERAGE_OPTIONS` chips), amount presets/custom/slider, an order summary (size, leverage, max loss, remaining, max-loss price for leverage), and a submit button whose disabled label says why. Hidden until a coin is picked. Mobile: valid-order button sticks above the bottom nav (`.pf-sticky-submit`).
- `app/duel/portfolio/OpenPositions.tsx` — one card per position: colored edge (long brand / short negative / spot `--spot`), unrealized P&L as the lead figure, size/entry/current/return, sparkline, opened-ago, close action.
- `app/duel/portfolio/PortfolioSummary.tsx` — segmented allocation bar by coin + available, total exposure (committed × leverage), open P&L.
- `app/duel/portfolio/ClosedPositions.tsx` — this session's closed positions (first 4, expandable). `SessionHistory.tsx` — settled sessions: latest 3, "View session history" expands the fetched list; each row expands to start/settle/stake/final.
- `app/duel/portfolio/ui.tsx` — formatters (`usd` uses subscript-zero notation for sub-$0.0001 prices), `CoinImage`, `Sparkline`, `PriceChart`, `useFlash` (P&L tint on change), `useTokenHistory` (page-wide client cache, 5 min refresh). Styles: `.pf-*` + `--ember`/`--spot` tokens in `app/globals.css`; `.portfolio-game` reverts the global `button, input { font: inherit }` so Tailwind text utilities apply.

## Known non-behaviors

- No cross-session leaderboard or full position history browsing beyond the current session + a short list of recent settled sessions (`docs/roadmap.md`).
- Base only — no other chain's meme coins.
- `positions`/`portfolio_sessions` rows accumulate with no cleanup, same as `matches`/the retired `readings`.
