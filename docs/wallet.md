# Wallet dashboard

Status: built. `/wallet` (`app/wallet/page.tsx`) connects a Coinbase Wallet
SDK wallet (no browser extension, no Clerk sign-in) and shows its real Base
holdings across two tabs: **Portfolio** (a balance chip + a plain list of
owned coins) and **Advanced** (a token explorer + detail/buy-sell layout,
modeled on the 24h Portfolio game's UI but not time-boxed).

## Connection

`app/lib/useWalletConnection.ts` owns the Coinbase Wallet SDK state machine
(connect/disconnect/switch, the Smart Wallet handshake-race handling, the
`accountsChanged`/`chainChanged` listeners, the `wallet-updated` event). Both
`app/wallet/page.tsx` (dashboard) and `app/WalletDesk.tsx` (still backs
`QuickTicketBar`'s floating ticket, `docs/architecture.md`) call this one
hook rather than each keeping their own copy.

## No-auth data routes

The wallet page has never required Clerk sign-in, only a connected wallet
(`app/api/wallet/holdings/route.ts` has no `auth()` check — "public on-chain
data"). The dashboard's other data needs are served by no-auth mirrors of the
Clerk-gated `/api/tokens/*` routes the 24h Portfolio game uses, so the gate
doesn't leak into the wallet page — same lib functions underneath, just
without `auth()`:

| Route | Wraps | Notes |
| --- | --- | --- |
| `GET /api/wallet/holdings?address=` | `lib/alchemy.ts getWalletHoldings` | `WalletTokenHolding` carries `change24h` |
| `GET /api/wallet/eth` | `lib/basePrices.ts getTokenSummaries` | native ETH has no pool of its own — priced via its WETH proxy (`0x4200…0006`), relabeled `address: "eth"`, `symbol: "ETH"` |
| `POST /api/wallet/history {addresses, period?}` | `lib/tokenHistory.ts getTokenHistories` | mirrors `/api/tokens/history`; the `"eth"` sentinel is swapped for the WETH address before the lookup and swapped back in the response |
| `GET /api/wallet/search?q=` | `lib/basePrices.ts searchTokens` | mirrors `/api/tokens/search` |
| `GET /api/wallet/trending`, `GET /api/wallet/new` | `lib/tokenHistory.ts getTrendingTokens`/`getNewTokens` | mirror `/api/tokens/trending`/`/api/tokens/new` |
| `POST /api/wallet/prices {addresses}` | `lib/basePrices.ts getTokenPrices`/`getTokenSummaries` | mirrors `/api/tokens/prices` |
| `GET /api/wallet/activity?address=` | `lib/alchemy.ts getWalletActivity` | kept as working infra but **not called by any UI right now** — Recent activity was pulled from the dashboard (see Known non-behaviors) |

All: `force-dynamic`, `Cache-Control: no-store`, never throw — same invariants as every other route (`docs/architecture.md`).

## Client (`app/wallet/`)

- `WalletDashboard.tsx` — orchestrator: polls holdings (~10s) and the ETH quote (~10s); builds one unified `Coin[]` (native ETH + ERC-20, `types.ts`); derives the chip's 24h $/% change from each coin's own real `change24h`; holds the Portfolio/Advanced tab, expanded-coin, and action-sheet state.
- A Portfolio/Advanced switcher uses its own `.wd-tabs` underline style (Coinbase Wallet home's Coins/Collectibles/Orders look), not the shared `.feed-tabs` pill used elsewhere in the app.
- **Portfolio tab**: `BalanceChip.tsx` (big centerpiece total on a dotted-grid card + 24h change + Swap/Send/Deposit tiles, digit-diff tint on change) above `CoinList.tsx` (search + sort over a Coinbase-style table — `CoinRow.tsx` rows under an Asset/Balance/Portfolio/Price header, portfolio % computed from each coin's share of `totalUsd`; no per-row charts; the Portfolio column and its header drop out under 620px. Frozen ordering — re-sorted only when the sort/search view or the coin set changes, never on a price tick, same idiom as `app/duel/portfolio/TokenExplorer.tsx`). Selecting a row expands into `CoinDetailPanel.tsx` (its own big chart via `app/MarketChart.tsx`, same usage as `app/duel/portfolio/TokenDetail.tsx`; states plainly that avg-entry/return aren't tracked rather than faking them).
- **Advanced tab**: `AdvancedTab.tsx` lays out `app/duel/portfolio/TokenExplorer.tsx` (reused directly, not forked — see its `endpoints` prop, `docs/portfolio.md`) next to `AdvancedTokenDetail.tsx` (chart + market stats + factual description + Buy/Sell, modeled on `app/duel/portfolio/TokenDetail.tsx` minus its Embers-based `OrderForm`). Below `lg` only one pane shows (no tab switcher): tapping a row opens the detail, its "← Explore" button returns to the table. Explorer rows aren't limited to owned coins — Buy/Sell on any Base token opens the Swap sheet with that token preselected (`SwapSheet`'s `initialFrom`/`initialTo`/`extraToken` props cover a token that isn't in the wallet's own holdings yet).
- `ActionSheet.tsx` + `ActionSheets.tsx` (Deposit/Send/Swap) — presentation only. Deposit shows the real connected address (safe, already-public) with copy-to-clipboard; Send/Swap collect inputs but end in a "not wired up yet" notice.
- `useWalletHistory.ts` — client cache pointed at `/api/wallet/history`, same pattern as `app/duel/portfolio/ui.tsx useTokenHistory`; used by `CoinDetailPanel.tsx` and `AdvancedTokenDetail.tsx` for their charts (not by the Portfolio tab's list, which has no charts at all).

Reuses `app/duel/portfolio/ui.tsx`'s `CoinImage`/`Change`/`LivePrice`/`StarButton`/`useFlash`/`usd` and `app/duel/portfolio/watchlist.ts`'s `useWatchlist` rather than re-implementing them — the watchlist is shared app-wide (one "tokens I'm watching" concept, not per-feature).

## Known non-behaviors (see also `docs/roadmap.md`)

- **No cost basis.** Avg entry and total return are not shown for any holding — Prophecy only ever sees the balance currently in a connected wallet, never what was paid for it.
- **Deposit/Send/Swap are UI-only.** Deposit shows the real connected address; Send/Swap collect inputs but never call `eth_sendTransaction` or any swap router, on either tab.
- **Recent activity and Creator earnings are out of the UI.** `getWalletActivity`/`/api/wallet/activity` (confirmed on-chain transfers, Received/Sent/Swapped) still exist and work but have no caller; the mock creator-earnings stub and its card were deleted outright rather than left unrendered. Re-adding either is mostly a presentation-layer job.
- **No pending-transaction state**, for the same reason Send/Swap don't move funds yet.
