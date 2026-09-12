# multiplayer (Quick Play)

Status: built. Server-authoritative networked Quick Play — the only mode with a
DB, server state, or a second client. Pulse and 24hr Battle are untouched.

## Shape

- One `matches` row = one round, single source of truth (`db/schema.ts:20`).
- Identity: anonymous per-browser UUID in `localStorage.playerId` (`app/lib/playerId.ts:20`). Not Clerk; sign-in stays optional and unrelated.
- Sync: ~1s polling (`app/duel/[market]/match/[matchId]/page.tsx:14`), no WebSocket registry. Lobby list polls at 3s (`app/page.tsx:17`), the queue at 1s (`app/page.tsx:22`).
- Nobody sits in a room alone: an `open` match is waited out on the lobby page (`app/page.tsx:340-352`); the room is entered only once `status` leaves `open`.
- No balance deduction. `wager` is stored and displayed only.

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
- `predict` — hard 15s window: `LOCK_SECONDS` (`lib/match.ts:34`) from `predictStartAt`, stamped when p2 joins (`db/schema.ts:39`). Predictions stay hidden from each other for its whole length (`lib/match.ts:181`).
- Expiry is lazy, like settlement: `expireLocksIfDue` (`lib/match.ts:81`) forfeits to whoever locked, or voids the round as a tie if neither did. Both leave `finalPrice` null, which is how the client tells a forfeit from a priced result (`app/duel/[market]/match/[matchId]/page.tsx:229`).
- `countdown` — deadline = `roundStartAt + timerSeconds` (`lib/match.ts:25`). Needs nobody online; the two stored predictions are enough. Both predictions go public here, not at settle: they are already frozen, so there is nothing left to game (`lib/match.ts:181`).
- `settled` — final price + winner written once, idempotently.

## Concurrency (no transactions)

`db/index.ts` uses `drizzle-orm/neon-http` — one HTTP request per statement, no
multi-statement transactions or row locks. Every transition is a single guarded
`UPDATE ... WHERE <guard> RETURNING *`; 0 rows back = someone else won the race.

| Transition | Guard | Loser does |
| --- | --- | --- |
| join | `status='open' AND player2_id IS NULL` | try next candidate, else create (`app/api/match/find-or-create/route.ts:75-93`) |
| lock | `status='predict' AND prediction{N} IS NULL` | re-read, return current view (`app/api/match/[id]/lock/route.ts:63-69`) |
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
| `POST /api/match/[id]/join` | take a specific open match (lobby list path) |
| `POST /api/match/[id]/lock` | write this player's prediction, start countdown on the 2nd; 409 once the 15s window has closed (`app/api/match/[id]/lock/route.ts:39`) |
| `POST /api/match/[id]/leave` | delete while `open`/`predict`; 409 once counting down |
| `GET /api/match/open?market=&mode=&playerId=` | joinable matches with a fresh host heartbeat |

Validation on entry: market must price (`lib/spotPrice.ts:12`), mode must be
`quick-play`, wager integer 1..1,000,000, timer 10..3600s.

## Client

- `app/duel/[market]/match/[matchId]/page.tsx` — the room. Renders by `status`; one prediction column plus an opponent column. Stops polling on `settled` or 404.
- One ticker drives both deadlines — the lock window in `predict`, the round in `countdown` (`app/duel/[market]/match/[matchId]/page.tsx:116-133`).
- `<PriceChart>` still reads the browser's own `usePriceFeed()` — the chart stays client-direct to Coinbase, no server round trip. Only `roundStart`/lock-marker times come from the poll.
- Settlement freezes the series with the final point pinned to the deadline, not to whenever the tab noticed (`app/duel/[market]/match/[matchId]/page.tsx:135-144`). A forfeit has no final price, so nothing freezes.
- Lobby Play button for Quick Play is an async matchmaker, not a `Link` (`app/page.tsx:186-217`); Open Matches rows are join buttons (`app/page.tsx:388-399`), inert for your own row while you hold it.
- Queueing replaces the whole Quick Play control panel rather than disabling it — the criteria are already committed to a row (`app/page.tsx:340-352`). Cancel deletes the row via `leave` (`app/page.tsx:263-277`); the room is prefetched while waiting so navigation does not eat into the 15s (`app/page.tsx:223`).

## Verified

Two-player round end to end: auto-match on identical criteria, browse-join by
id, the creator held on the lobby until someone joins, a ~15s lock window
opening on join, predictions hidden through `predict` and both revealed at
`countdown`, countdown starting only on the 2nd lock, settlement idempotent
under two simultaneous polls, 3-way join race yielding exactly one winner,
`predict`-phase leave 404-ing the opponent, and an abandoned `open` match
dropping out of listing/matchmaking after ~9s.

Lock-window expiry, over the API: one player locked → the other forfeits
(`winner` set, `finalPrice` null, both role-scoped views agreeing); neither
locked → `winner: "tie"`, void; a lock arriving after either → 409.
