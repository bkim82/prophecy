# multiplayer (Quick Play + Pulse)

Status: built. Server-authoritative networked Quick Play and Pulse. Both modes
share matchmaking, presence, polling, and lazy settlement.

## Shape

- One `matches` row = one round, single source of truth (`db/schema.ts:20`). Pulse
  positions, realized P&L, and final P&L live in the same row.
- Identity: anonymous per-browser UUID in `localStorage.playerId` (`app/lib/playerId.ts:20`). Not Clerk; sign-in stays optional and unrelated.
- Sync: ~1s polling (`app/duel/[market]/match/[matchId]/page.tsx:14`), no WebSocket registry. Lobby list polls at 3s (`app/page.tsx:17`), the queue at 1s (`app/page.tsx:22`).
- Nobody sits in a room alone: an `open` match is waited out on the lobby page (`app/page.tsx:389-407`); the room is entered only once `status` leaves `open`. The queued state exposes a mode-specific shareable invite URL (`app/page.tsx:192-198`) that auto-joins a friend as player 2 (`app/duel/[market]/match/[matchId]/page.tsx:65-97`, `app/duel/[market]/pulse/[matchId]/page.tsx:57-84`).
- Quick Play has no balance deduction; its `wager` is stored and displayed only. Pulse reserves each entry's stake from the player's round bankroll and returns that stake when the position closes.

## Status machine

```
open --(p2 joins)--> predict --(both locked)------> countdown --(deadline)--> settled
 |                       |  \--(15s window expires)-> settled (forfeit / void)
 (creator leaves)        (either leaves)
 v                       v
(row deleted)         (row deleted)
```

- Maps 1:1 onto the client `Phase` names in [game-loop.md](game-loop.md); only the owner changed.
- `open` — auto-joinable by matching `(market, mode, wager, timerSeconds)` exactly, or by id from the lobby list.
- `predict` — Quick Play has a hard 15s lock window; Pulse has a 5s automatic pre-round countdown (`PULSE_START_SECONDS`, `lib/match.ts`) from `predictStartAt`. Pulse starts even if neither player has entered yet.
- Expiry is lazy, like settlement: `expireLocksIfDue` (`lib/match.ts:81`) forfeits to whoever locked, or voids the round as a tie if neither did. Both leave `finalPrice` null, which is how the client tells a forfeit from a priced result (`app/duel/[market]/match/[matchId]/page.tsx:229`).
- `countdown` — deadline = `roundStartAt + timerSeconds` (`lib/match.ts:25`). Needs nobody online; Quick Play predictions or any Pulse positions are enough. Pulse supports server-priced entries up to the player's available bankroll and independent closes during this phase.
- `settled` — final price + winner written once, idempotently.

## Concurrency (no transactions)

`db/index.ts` uses `drizzle-orm/neon-http` — one HTTP request per statement, no
multi-statement transactions or row locks. Every transition is a single guarded
`UPDATE ... WHERE <guard> RETURNING *`; 0 rows back = someone else won the race.

| Transition | Guard | Loser does |
| --- | --- | --- |
| join | `status='open' AND player2_id IS NULL` | try next candidate, else create (`app/api/match/find-or-create/route.ts:75-93`) |
| lock | `status='predict' AND prediction{N} IS NULL` | re-read, return current view |
| Pulse action | `status='countdown' AND the caller's position JSON is unchanged` | re-read, return current view |
| start countdown | `status='predict'` | nothing — only the 2nd locker sees both non-null (`app/api/match/[id]/lock/route.ts:71-80`) |
| expire lock window | `status='predict'`, plus `prediction{N} IS NULL` re-asserted for every slot read empty | re-read; a lock that beat it owns the row (`lib/match.ts:90-115`) |
| settle | `status='countdown'` | re-read, use the winner's values (`lib/match.ts:138-145`) |

## Presence

- `PRESENCE_MS = 8000` (`lib/match.ts:14`). Stale `open` rows are filtered out of listing and matchmaking, never deleted — a dead row is just invisible, so there is no cleanup cron.
- Heartbeat is folded into the poll: `touchAndRead` stamps the caller's `last_seen` and reads the row in one statement via a `CASE` (`lib/match.ts:52`). No separate heartbeat endpoint.
- A queued lobby therefore polls at room speed, not lobby speed (`app/page.tsx:22`): a 3s beat would age its own row out of the very list it is waiting to be found in.
- Only matters pre-lock. During `predict` it drives "opponent disconnected"; the 15s window, not presence, is what ends an abandoned match.

## Timestamps

- `matches` timestamps are `timestamptz`, unlike `users.createdAt` (`db/schema.ts:35-47`). Bare `timestamp` columns store whatever local time the writer was in — a row written from a laptop and read on a UTC server lands hours out, which reads as "that player went offline".
- Server sends `serverNow` with every view (`lib/match.ts:218`); the client subtracts the skew before running the lock window, the countdown, or chart markers (`app/duel/[market]/match/[matchId]/page.tsx:52-56`).

## Routes

| Route | Does |
| --- | --- |
| `POST /api/match/find-or-create` | join oldest live `open` match with identical criteria, else create one. Returns `status`, which is how the lobby decides between entering the room and queueing (`app/api/match/find-or-create/route.ts:74`,`:97`,`:117`) |
| `GET /api/match/[id]?playerId=` | role-scoped view + heartbeat + lock-window expiry + lazy settlement (`app/api/match/[id]/route.ts:38`). Polled by the room, and by the lobby while queued |
| `POST /api/match/[id]/join` | take a specific fresh open match (lobby list or invite link path) |
| `POST /api/match/[id]/lock` | write this player's prediction, start countdown on the 2nd; 409 once the 15s window has closed (`app/api/match/[id]/lock/route.ts:39`) |
| `POST /api/match/[id]/action` | Pulse server-priced `enter` actions up to available bankroll and per-position `close` actions |
| `POST /api/match/[id]/leave` | delete while `open`/`predict`; 409 once counting down |
| `GET /api/match/open?market=&mode=&playerId=` | joinable matches with a fresh host heartbeat |

Validation on entry: market must price (`lib/spotPrice.ts:12`), mode must be
`quick-play` or `pulse`, wager integer 1..1,000,000, timer 10..3600s. Pulse
actions additionally validate side, stake ≤ $100 and available bankroll, leverage,
and position id.

## Client

- `app/duel/[market]/match/[matchId]/page.tsx` — Quick Play room.
- `app/duel/[market]/pulse/[matchId]/page.tsx` — multiplayer Pulse room; renders positions and live P&L, stops polling on `settled` or 404.
- Leaving a room's page never calls `leave` — only the explicit Cancel/Leave button does — so a match already survives navigation server-side. `app/lib/activeMatch.ts` persists `{matchId, market, mode}` to `localStorage` once a room's poll sees `predict`/`countdown` (`app/duel/[market]/match/[matchId]/page.tsx:73-84`, `app/duel/[market]/pulse/[matchId]/page.tsx` equivalent), cleared on `settled`, 404/403 (`gone`), or the Leave button. `app/ActiveMatchBar.tsx`, mounted in `app/layout.tsx`, reads that pointer on every page, polls the same role-scoped `GET /api/match/[id]` at 2s once it's not on the match's own route, and renders a fixed bottom pill linking back in. Deliberately not set while `open` (queued/waiting) — that phase already has first-class UI on the lobby page (`app/page.tsx` `queue` panel).
- When that off-page match is Pulse and `status === "countdown"` ("Round in progress"), the bar also mounts `app/PulseMiniDock.tsx`: condensed stake/leverage/long/short controls and an open-position list, calling the same `POST /api/match/[id]/action` as the room and applying the response straight into the bar's own `view` state. It's kept mounted (with its own `usePriceFeed`) for the whole countdown phase and only toggled visible via CSS, so hover has no seed/socket delay. Opens on `mouseenter`/closes on `mouseleave` (desktop); on touch, tapping the pill toggles it and a document `pointerdown` outside the bar closes it — the pill's `Link` navigation is suppressed (`preventDefault`) whenever the dock is eligible, so "open the full room" only happens via the link inside the dock. Quick Play never gets this — it has no actions to take mid-round.
- One ticker drives both deadlines — the lock window in `predict`, the round in `countdown` (`app/duel/[market]/match/[matchId]/page.tsx:116-133`).
- `<PriceChart>` still reads the browser's own `usePriceFeed()` — the chart stays client-direct to Coinbase, no server round trip. Only `roundStart`/lock-marker times come from the poll.
- Settlement freezes the series with the final point pinned to the deadline, not to whenever the tab noticed (`app/duel/[market]/match/[matchId]/page.tsx:135-144`). A forfeit has no final price, so nothing freezes.
- Lobby Play button for Quick Play is an async matchmaker, not a `Link` (`app/page.tsx:186-217`); Open Matches rows are join buttons (`app/page.tsx:388-399`), inert for your own row while you hold it. While queued, Share invite uses native sharing when available and clipboard copy otherwise, preserving the queued mode in the URL (`app/page.tsx:192-219`, `app/page.tsx:389-407`).
- Queueing replaces the whole Quick Play control panel rather than disabling it — the criteria are already committed to a row (`app/page.tsx:340-352`). Cancel deletes the row via `leave` (`app/page.tsx:263-277`); the room is prefetched while waiting so navigation does not eat into the 15s (`app/page.tsx:223`).

## Verified

Two-player round end to end: auto-match on identical criteria, browse-join by
id, the creator held on the lobby until someone joins, a ~15s lock window
opening on join, predictions hidden through `predict` and both revealed at
`countdown`, countdown starting only on the 2nd lock, settlement idempotent;
Pulse settlement closes remaining positions and releases their reserved stakes
into realized balance
under two simultaneous polls, 3-way join race yielding exactly one winner,
`predict`-phase leave 404-ing the opponent, and an abandoned `open` match
dropping out of listing/matchmaking after ~9s.

Lock-window expiry, over the API: one player locked → the other forfeits
(`winner` set, `finalPrice` null, both role-scoped views agreeing); neither
locked → `winner: "tie"`, void; a lock arriving after either → 409.
