# game-loop

Quick Play's loop is server-owned: a `matches` row holds the phase and the
`/api/match/*` routes move it; clients poll and render what they are told (see
[multiplayer-plan.md](multiplayer-plan.md) for the routes, guards and presence).
Pulse still runs its whole loop in `app/duel/btc/pulse/page.tsx`.

The phase vocabulary below is unchanged — only the owner moved. `settling` is
the one client-only phase left: server-side it is still `countdown`, shown while
a poll past the deadline has not yet come back with a result.

## Phases

```
open --(opponent joins)--> predict --(both locked)--> countdown --(deadline)--> settled
 |                             |   \--(15s window)--------------------------------^
 (cancel/expire)               (either leaves)                   (settling: client-only,
 v                             v                                  poll in flight)
(row deleted)               (row deleted)
```

Server status: `open | predict | countdown | settled` (`db/schema.ts:26`,
`lib/match.ts:7`). `open` has no client-side equivalent — it is the pre-round
wait for an opponent, and it is now waited out on the lobby, not in the room
(`app/page.tsx:340-352`). `settling` and `result` are both `settled`
server-side. There is no loop back: "play again" is a new row, not a reset.

| Phase | State |
| --- | --- |
| `open` | waiting for an opponent, Cancel available, chart live |
| `predict` | your input enabled, opponent's value hidden, 15s lock timer visible, Leave available |
| `countdown` | both predictions locked+immutable+revealed, timer visible, chart shaded from `roundStartAt`, Leave refused |
| `settling` | client-only: deadline passed, the settling poll has not returned (`app/duel/[market]/match/[matchId]/page.tsx:234`). `locking` is its twin for the lock window (`:235`) |
| `settled` | winner shown, both predictions revealed, chart frozen, per-player breakdown |
| `settled` (forfeit) | `finalPrice` null: the lock window closed on an unlocked player. Its own panel, no chart freeze, no diffs (`app/duel/[market]/match/[matchId]/page.tsx:229`,`:531-557`) |

## Lock window

- 15s, fixed for every match: `LOCK_SECONDS` (`lib/match.ts:34`) from `predictStartAt`, stamped by whichever join route took the seat (`app/api/match/find-or-create/route.ts:86`, `app/api/match/[id]/join/route.ts:31`).
- Sent as `lockDeadlineAt`, non-null only in `predict` (`lib/match.ts:213`), and run by the same skew-corrected ticker as the round countdown (`app/duel/[market]/match/[matchId]/page.tsx:116-133`).
- Both locked before it runs out → the countdown starts on the 2nd lock, not at the deadline. The window is a floor on nothing, a ceiling on waiting.
- `expireLocksIfDue` (`lib/match.ts:81`) closes it on whichever poll first arrives past the deadline: one locked → that player wins by forfeit; neither → `winner: "tie"`, void. Both write `finalPrice` null. A row that somehow has both predictions at expiry starts the countdown dated to the deadline (`:94`).
- Guards re-assert every slot read empty (`:103-111`), so a lock landing in the same instant either wins the seat or loses to the expiry — never both.

## lock — `app/api/match/[id]/lock/route.ts:17`

- Rejects non-finite or ≤0 values (`:25`), non-players (403, `:35`), and any status but `predict` (409, `:41`) — including a status `expireLocksIfDue` has just moved on (`:39`).
- Writes under `status='predict' AND prediction{N} IS NULL` (`:46-60`). 0 rows back = already locked; re-read and return the current view rather than erroring (`:63-69`).
- The countdown transition is a *second* guarded update, run only by the request that sees both predictions non-null (`:71-80`) — so `roundStartAt` is stamped exactly once however the two locks interleave.
- One `now` per request feeds both `lockedAt{N}` and `roundStartAt` (`:45`), so the 2nd lock's chart marker sits exactly on the round-band edge.
- Either player may lock first, order irrelevant. Once both are locked, the room shows compact cards with only each player's stored price (`app/duel/[market]/match/[matchId]/page.tsx:238`,`:364-490`). Before then, the input is enabled only for an unlocked player. Enter key = lock (`app/duel/[market]/match/[matchId]/page.tsx:404-406`).
- `lockedAt{1,2}` → `PredictionLine.at` after skew correction → vertical lock markers (`app/duel/[market]/match/[matchId]/page.tsx:188-209`, see chart.md). Both lines are drawn from `countdown` on, since the server stops withholding the opponent's there (`lib/match.ts:181`).

## Countdown

- Length is per-match: `timerSeconds`, 10–3600s, chosen in the lobby (`app/api/match/find-or-create/route.ts:11-14`). No shared constant with Pulse any more.
- Deadline is `roundStartAt + timerSeconds`, computed server-side (`lib/match.ts:25`) and sent with every view.
- The client subtracts clock skew (`serverNow` minus local `Date.now()`) before using it (`app/duel/[market]/match/[matchId]/page.tsx:52-56`), then recomputes `ceil((deadline-now)/1000)` every 200ms (`app/duel/[market]/match/[matchId]/page.tsx:123-133`). Immune to tab throttling and to a server in another timezone.
- Hitting 0 does nothing locally — settlement is the server's, triggered by whichever poll first arrives past the deadline.

## settleIfDue(row) — `lib/match.ts:123`

1. No-ops unless `status='countdown'`, the deadline has passed, and both predictions exist (`:124-127`).
2. `getSpotPrice()` walks Coinbase → Binance (`lib/spotPrice.ts:39`).
3. `diff1`, `diff2` = abs distance from the settled price (`:134-135`).
4. Winner = smaller diff; equal → tie (`:136`).
5. Written under `status='countdown'` (`:138-142`), so two simultaneous polls cannot double-settle — the loser re-reads and uses the winner's values (`:145`).
6. On price-source failure the row stays in `countdown` and the next poll retries (`:130-132`); nothing is lost, but nothing tells the player either (see roadmap.md).

Runs on `expireLocksIfDue`'s result, not on the raw row (`app/api/match/[id]/route.ts:38`) — expiry can hand back a `countdown` row.

Ties only occur on exact-match input (abs diff, floats) (`lib/match.ts:136`) — matches UI copy "Tie — identical predictions." A forfeit tie is a different thing: no predictions at all, `finalPrice` null.

## Play again

There is no in-place reset: a round is a row, so "Play Again" is a link back to
the lobby (`app/duel/[market]/match/[matchId]/page.tsx:571-577`) and the next match is a new row. The client
freezes its chart snapshot once, on first seeing a priced `settled`, with the
final point pinned to the deadline rather than to whenever the tab noticed
(`app/duel/[market]/match/[matchId]/page.tsx:135-144`), and stops polling (`:88`).

## Known non-behaviors (see roadmap.md for detail)

- A `predict` match whose opponent walks away now ends on the 15s window, by forfeit. An `open` one still needs Cancel or presence expiry.
- `wager` is reserved from each signed-in player's balance on match entry, refunded for pre-round exits/ties, and paid as a 2× pot to the winner via the idempotent payout ledger (`lib/balance.ts`, `db/schema.ts`).
- No cross-round score or history; `matches` rows accumulate with no cleanup.
