# multiplayer (Pulse)

Status: built. Server-authoritative networked Pulse: matchmaking, presence,
polling, and lazy settlement.

## Shape

- One `matches` row = one round, single source of truth (`db/schema.ts:20`). Pulse
  positions, realized P&L, and final P&L live in the same row.
- Identity: anonymous per-browser UUID in `localStorage.playerId` (`app/lib/playerId.ts:20`). Not Clerk; sign-in stays optional and unrelated.
- Sync: ~1s polling (`app/duel/[market]/pulse/[matchId]/page.tsx:22`), no WebSocket registry. Lobby list polls at 3s (`app/duel/page.tsx:25`), the queue at 1s (`app/duel/page.tsx:30`).
- Nobody sits in a room alone: an `open` match is waited out on the lobby page (`app/duel/page.tsx` `queue` panel); the room is entered only once `status` leaves `open`. The queued state exposes a shareable invite URL (`app/duel/page.tsx` `shareInvite`) that auto-joins a friend as player 2 (`app/duel/[market]/pulse/[matchId]/page.tsx:59`, `:89-99`).
- Requires Clerk sign-in. Each player's `wager` is reserved atomically from `users.balance` on entry; open/predict cancellation refunds it, ties refund both stakes, and the winner receives the 2× pot (`lib/balance.ts`). Pulse reserves each entry's stake from the player's round bankroll and returns that stake when the position closes.

## Status machine

```
open --(p2 joins)--> predict --(5s countdown)--> countdown --(deadline)--> settled
 |                       |
 (creator leaves)        (either leaves)
 v                       v
(row deleted)         (row deleted)
```

- Maps 1:1 onto the client `Phase` names in [game-loop.md](game-loop.md); only the owner changed.
- `open` — auto-joinable by matching `(market, mode, wager, timerSeconds)` exactly, or by id from the lobby list.
- `predict` — 5s automatic pre-round countdown (`PULSE_START_SECONDS`, `lib/match.ts:33`) from `predictStartAt`. Starts even if neither player has entered yet; the start is lazy, like settlement (`expireLocksIfDue`, `lib/match.ts:80`).
- `countdown` — deadline = `roundStartAt + timerSeconds` (`lib/match.ts:25`). Needs nobody online. Supports server-priced entries up to the player's available bankroll and independent closes during this phase.
- `settled` — final price + winner written once, idempotently.

## Concurrency (no transactions)

`db/index.ts` uses `drizzle-orm/neon-http` — one HTTP request per statement, no
multi-statement transactions or row locks. Every transition is a single guarded
`UPDATE ... WHERE <guard> RETURNING *`; 0 rows back = someone else won the race.

| Transition | Guard | Loser does |
| --- | --- | --- |
| join | `status='open' AND player2_id IS NULL` plus atomic balance reservation | refund if the guarded seat is lost, else try next candidate or create (`app/api/match/find-or-create/route.ts:88-115`) |
| Pulse action | `status='countdown' AND the caller's position JSON is unchanged` | re-read, return current view |
| start countdown | `status='predict'` | re-read (`lib/match.ts:85-90`) |
| settle | `status='countdown'` | re-read, use the winner's values (`lib/match.ts:116-132`) |

## Presence

- `PRESENCE_MS = 8000` (`lib/match.ts:14`). Stale `open` rows are filtered out of listing and matchmaking, never deleted — a dead row is just invisible, so there is no cleanup cron.
- Heartbeat is folded into the poll: `touchAndRead` stamps the caller's `last_seen` and reads the row in one statement via a `CASE` (`lib/match.ts:52`). No separate heartbeat endpoint.
- A queued lobby therefore polls at room speed, not lobby speed (`app/duel/page.tsx:29`): a 3s beat would age its own row out of the very list it is waiting to be found in.
- Only matters pre-round. During `predict` it drives "opponent disconnected"; the 5s countdown starts the round regardless.

## Timestamps

- `matches` timestamps are `timestamptz`, unlike `users.createdAt` (`db/schema.ts:35-47`). Bare `timestamp` columns store whatever local time the writer was in — a row written from a laptop and read on a UTC server lands hours out, which reads as "that player went offline".
- Server sends `serverNow` with every view (`lib/match.ts:223`); the client subtracts the skew before running the pre-round timer, the countdown, or chart markers (`app/duel/[market]/pulse/[matchId]/page.tsx:55-62`).

## Routes

| Route | Does |
| --- | --- |
| `POST /api/match/find-or-create` | join oldest live `open` match with identical criteria, else create one. Returns `status`, which is how the lobby decides between entering the room and queueing (`app/api/match/find-or-create/route.ts:74`,`:97`,`:117`) |
| `GET /api/match/[id]?playerId=` | role-scoped view + heartbeat + pre-round expiry + lazy settlement (`app/api/match/[id]/route.ts:38`). Polled by the room, and by the lobby while queued |
| `POST /api/match/[id]/join` | take a specific fresh open match (lobby list or invite link path) |
| `POST /api/match/[id]/action` | Pulse server-priced `enter` actions up to available bankroll and per-position `close` actions |
| `POST /api/match/[id]/leave` | delete while `open`/`predict`; 409 once counting down |
| `GET /api/match/open?market=&mode=&playerId=` | joinable matches with a fresh host heartbeat |
| `GET /api/match/recent` | signed-in user's newest 5 settled matches, all markets — `settledMatchesFor` + `historyEntryFor` + `opponentNames` (`lib/opponentNames.ts`), same naming as the profile Matches tab. Rendered by the lobby's Recent results: coin, `vs <opponent>`, Won/Lost/Tie, your round P&L, relative time (`app/lib/playedLabel.ts`); fetched once per mount, so returning from a room refreshes it |

Validation on entry: market must price (`lib/spotPrice.ts:12`), mode must be
`pulse`, caller must be a signed-in Clerk user, wager integer
1..1,000,000 and no more than the user's balance, timer 10..3600s. Pulse
actions additionally validate side, stake ≤ $100 and available bankroll, leverage,
and position id.

## Client

- `app/duel/[market]/pulse/[matchId]/page.tsx` — multiplayer Pulse room; renders positions and live P&L, stops polling on `settled` or 404.
- Leaving a room's page never calls `leave` — only the explicit Cancel/Leave button does — so a match already survives navigation server-side. `app/lib/activeMatch.ts` persists `{matchId, market, mode}` to `localStorage` once a room's poll sees `predict`/`countdown` (`app/duel/[market]/pulse/[matchId]/page.tsx:70-71`), cleared on `settled`, 404/403 (`gone`), or the Leave button. `app/ActiveMatchBar.tsx`, mounted in `app/layout.tsx`, reads that pointer on every page, polls the same role-scoped `GET /api/match/[id]` at 2s once it's not on the match's own route, and renders a fixed bottom pill linking back in. Deliberately not set while `open` (queued/waiting) — that phase already has first-class UI on the lobby page (`app/duel/page.tsx` `queue` panel).
- When that off-page match is in `status === "countdown"` ("Round in progress"), the bar also mounts `app/PulseMiniDock.tsx`: condensed stake/leverage/long/short controls and an open-position list, calling the same `POST /api/match/[id]/action` as the room and applying the response straight into the bar's own `view` state. It's kept mounted (with its own `usePriceFeed`) for the whole countdown phase and only toggled visible via CSS, so hover has no seed/socket delay. Opens on `mouseenter`/closes on `mouseleave` (desktop); on touch, tapping the pill toggles it and a document `pointerdown` outside the bar closes it — the pill's `Link` navigation is suppressed (`preventDefault`) whenever the dock is eligible, so "open the full room" only happens via the link inside the dock.
- One ticker drives both deadlines — the pre-round timer in `predict`, the round in `countdown` (`app/duel/[market]/pulse/[matchId]/page.tsx:121-127`).
- `<PriceChart>` still reads the browser's own `usePriceFeed()` — the chart stays client-direct to Coinbase, no server round trip. Only `roundStart`/trade-marker times come from the poll.
- Settlement freezes the series with the final point pinned to the deadline, not to whenever the tab noticed (`app/duel/[market]/pulse/[matchId]/page.tsx:132`).
- Lobby Play button is an async matchmaker, not a `Link` (`app/duel/page.tsx` `play`). Signed out, it is a Clerk `SignInButton` (modal) labelled "Sign in to play", not a disabled button. Styled violet (`.pulse-stage .play-button`, `--play-a/b`) — the only non-teal action on the page. While queued, Share invite uses native sharing when available and clipboard copy otherwise (`app/duel/page.tsx` `shareInvite`).
- Queueing replaces the whole play control panel rather than disabling it — the criteria are already committed to a row. Cancel deletes the row via `leave` (`app/duel/page.tsx` `cancelQueue`); the room is prefetched while waiting so navigation does not eat into the 5s (`app/duel/page.tsx:293`).

## Verified

Two-player round end to end: auto-match on identical criteria, browse-join by
id, the creator held on the lobby until someone joins, settlement idempotent;
settlement closes remaining positions and releases their reserved stakes
into realized balance
under two simultaneous polls, 3-way join race yielding exactly one winner,
`predict`-phase leave 404-ing the opponent, and an abandoned `open` match
dropping out of listing/matchmaking after ~9s.
