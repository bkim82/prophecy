# roadmap

Deliberate gaps in a prototype scoped to the core loop. Not bugs.

## Not built

| Gap | Detail |
| --- | --- |
| Real copy-trading / creator earnings | No ledger, fee split, or follower relationship exists anywhere; "Copy trade" on a feed post (`app/PostCard.tsx:107`) is just a button. The wallet briefly had a mock Creator earnings card, removed along with Recent activity when the dashboard was reworked into tabs (`docs/wallet.md`) |
| Wallet Recent activity has no UI home | `getWalletActivity`/`GET /api/wallet/activity` (`lib/alchemy.ts`) reads real confirmed transfers (Received/Sent/Swapped) and still works, but nothing in `app/wallet/*` renders it since the Portfolio tab became a plain coin list |
| Wallet Deposit/Send/Swap are UI-only | `app/wallet/ActionSheets.tsx` collects inputs but never calls `eth_sendTransaction` or a swap router, on either the Portfolio or Advanced tab; there is correspondingly no pending-transaction state — see [wallet-trading-plan.md](wallet-trading-plan.md) for the build plan and security protocols |
| Portfolio cross-session history/leaderboard | `GET /api/portfolio/session` returns only the current session plus a short list of recent settled sessions (`lib/portfolio.ts sessionHistoryFor`) — no full history browsing UI, no leaderboard across users |
| Real leaderboard | `app/OraclesLeaderboard.tsx` renders hand-ordered `TOP_TRADERS` per period from `app/lib/sidebarMocks.ts` — no P&L aggregation across users, `winRate`/`tier` are mock, no full leaderboard page (`View full leaderboard` only expands the 10 mock rows inline) |
| Real rank/tier system | `app/lib/rank.ts` is a hardcoded stub (`MOCK_CURRENT_RANK`/`MOCK_RANK_THRESHOLD`) gating `/exclusive`, plus `VIEWER_RANK = "Gold II"` gating profile portfolios — no computation, no persistence, not tied to Clerk `userId`. Sanctum separately assumes the viewer is `Oracle II` (`app/lib/roomsMocks.ts` `ROOM.subrank`) |
| Challenges: accept/play | Profile Challenge button + dialog (Pulse market/round/stake or 24h Portfolio stake) saves pending requests to `challenges` (`app/profile/challengeActions.ts`, rank gate `app/lib/rank.ts canChallenge`: at most one tier up) — targets are mock traders, so nobody can accept/decline, no Embers reserved, no match created. Incoming requests in the Omens rail's Notifications (`app/FeedNotifications.tsx`) are hand-written mocks (`app/lib/mockNotifications.ts`) whose Accept/Decline only change local state; the other notifications (mention/copy/follow) are mocks too; no 24h Portfolio head-to-head mode exists (see [profiles.md](profiles.md)) |
| Real profiles | `/profile/[handle]` reads `app/lib/mockProfiles.ts`/`mockPortfolios.ts` — follow toggle doesn't persist, no real follow graph. Own `/profile` has a real editable profile (photo via Clerk; name/handle/bio/location/website/banner in the `profiles` table) + match history, but its rank, followers, copy earnings and rail records are mocks (`app/lib/mockViewer.ts`), its Portfolio tab only links out, and no one else can view it — no public `/profile/[handle]` for real users yet (so the Pulse room's revealed opponent name links every opponent to the `@zane_lfg` mock for now, `OPPONENT_PROFILE_HREF` in `app/duel/[market]/pulse/[matchId]/page.tsx`), and the banner route is owner-only; the achievements rail's Elo/records/trophies are hand-picked mocks (`app/lib/mockAchievements.ts`), no Elo or stat tracking behind them (see [profiles.md](profiles.md)) |
| Sanctum: real money, real players, rank gating | `/sanctum` (`app/sanctum/SanctumView.tsx`) is the Oracle Room on live prices but mock everything else (`app/lib/roomsMocks.ts`) — no USD wallet rail/settlement (preview $1,000 balance), simulated room players + feed, local-only chat, hardcoded Oracle rank, no server-side room membership (see [sanctum.md](sanctum.md)) |
| Post composer / feed persistence | `/` and `/exclusive` render static arrays from `app/lib/mockPosts.ts`; `app/FeedComposer.tsx` only prepends to client state (gone on reload), likes/reposts/clash votes and post-page replies (`app/post/[id]/PostThread.tsx`) are local toggles (a vote adds one to the mock count and is gone on reload) — no database table, no server-side Clerk authorship. Copy trade and `+ Trade` don't open a position |
| Real Vouch / Defy | Vouch and Defy (`app/PostCard.tsx`, `app/PostShare.tsx`) are local repost toggles: nothing reaches followers' feeds or persists, and followed accounts' reposts are the hand-written `SHARES` in `app/lib/mockPosts.ts` |
| Real topic tagging / recommendation | For You covers and topic chips (`app/lib/topics.ts`) run on hand-tagged `Post.topics` + a client-side engagement/recency score over mock counts; interests live in localStorage, not on the Clerk user. No classifier tags new posts (composer posts get no topics), no server ranking, "Not interested" is a per-browser topic mute list (no per-post or per-author signal, nothing sent to a server) |
| Real post media | `Post.media` screenshots are HTML/SVG mocks (`app/PostMedia.tsx`); the composer can't attach images and there's no upload/storage pipeline or full-screen viewer |
| Daily BTC call | Feed's streak post (`app/lib/mockPosts.ts` `g-streak1`) implies a once-a-day BTC prediction settling at 11:59pm with a consecutive-day streak counter — no submission flow, settlement job, or streak computation exists anywhere in the app |
| Pulse leverage control | Fixed 1×–100× chips (`app/duel/btc/pulse/page.tsx:11`); no custom multiplier |
| Pulse spot accounting | `app/duel/btc/pulse/trading.ts` (`executeTrade`) is written and tested-by-eye but has no importers — the page models one leveraged directional position, not a cash/BTC portfolio |
| Pulse rival | "Nova · AI" is a local stub: side derived from the entry price's parity, fixed $48 × 10× size, no behaviour (`app/duel/btc/pulse/page.tsx:199-204`, `:301-306`) |
| No abandon timeout (`open` only) | `predict` is capped at 5s and always starts the round (`lib/match.ts:80`), but an `open` match nobody joins just stops being listed once the heartbeat goes stale — the creator is held on the lobby and must press Cancel (`app/duel/page.tsx` `cancelQueue`) |
| No match cleanup | `matches` rows are never deleted after `settled`; stale `open` rows self-filter by heartbeat but still accumulate. No cron, no TTL (`app/api/match/open/route.ts:28`) |
| No persistence outside a match | Multiplayer Pulse rounds persist in Postgres, but there is no cross-round score or history; solo Pulse keeps nothing |
| Round length vs chart window | Multiplayer Pulse's timer is per-match (10–3600s; lobby offers 60/120/300s), but any round > `WINDOW_MS`(1min) still scrolls off the chart's left edge before settling — the chart window is fixed |
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
- `PULSE_START_SECONDS` is a constant (`lib/match.ts:33`), unlike `timerSeconds`: the lobby cannot offer a longer or shorter pre-round countdown.
- A queued lobby tab that reloads drops its queue; the row it left behind stays listed until the heartbeat goes stale (~8s) and cannot be re-entered from the list (`app/duel/page.tsx:391`).
- A settlement-price outage leaves the row in `countdown` past its deadline; the next poll retries, so a long outage shows "Settling…" indefinitely with no user-visible error (`lib/match.ts:130-132`).
- Clerk components (`UserButton`, sign-in modal) keep their own default appearance — not wired to `data-theme`.
- Solo Pulse still hardcodes `ROUND_SECONDS=60` (`app/duel/btc/pulse/page.tsx:8`); multiplayer Pulse's length is per-match.
- No chart hover/tooltip/crosshair.
- Slow `/api/history` can resolve after socket has already committed points — merge+trim (`app/usePriceFeed.ts:60`) keeps it correct but chart visibly re-draws.
- The 100ms clock (`app/usePriceFeed.ts:48-51`) re-renders the match room 10x/s even when nothing else changes, on top of the 1s poll. Cheap at this size; would want memoising the chart if the page grows.
- Candle backfill is coarse (1-min granularity is Coinbase's finest), so a trades outage draws the window as ~3 straight segments. Paginating trades via the `after` cursor would fill it properly.

## Next fork

Networked multiplayer Pulse is built. The remaining fork
is cross-round history and broader game modes.
