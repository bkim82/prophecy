# game-loop

Multiplayer Pulse loops are server-owned: a `matches` row holds the phase and the
`/api/match/*` routes move it; clients poll and render what they are told (see
[multiplayer-plan.md](multiplayer-plan.md) for the routes, guards and presence).
The solo Pulse route still runs its own client-only loop in `app/duel/btc/pulse/page.tsx`.

The phase vocabulary below is unchanged — only the owner moved. `settling` is
the one client-only phase left: server-side it is still `countdown`, shown while
a poll past the deadline has not yet come back with a result.

## Phases

```
open --(opponent joins)--> predict --(5s pre-round countdown)--> countdown --(deadline)--> settled
 |                             |
 (cancel/expire)               (either leaves)                   (settling: client-only,
 v                             v                                  poll in flight)
(row deleted)               (row deleted)
```

Server status: `open | predict | countdown | settled` (`db/schema.ts:26`,
`lib/match.ts:7`). `open` has no client-side equivalent — it is the pre-round
wait for an opponent, and it is now waited out on the lobby, not in the room
(`app/duel/page.tsx` `queue` panel). `settling` and `result` are both `settled`
server-side. There is no loop back: "play again" is a new row, not a reset.

| Phase | State |
| --- | --- |
| `open` | waiting for an opponent, Cancel available, chart live |
| `predict` | 5s pre-round timer, Leave available |
| `countdown` | trading is live, timer visible, chart shaded from `roundStartAt`, Leave refused |
| `settling` | client-only: deadline passed, the settling poll has not returned |
| `settled` | winner shown, both P&Ls revealed, chart frozen |

## Pre-round countdown

- 5s: `PULSE_START_SECONDS` (`lib/match.ts:33`) from `predictStartAt`, stamped by whichever join route took the seat (`app/api/match/find-or-create/route.ts:98`, `app/api/match/[id]/join/route.ts:45`).
- Sent as `lockDeadlineAt`, non-null only in `predict` (`lib/match.ts:35`), and run by the same skew-corrected ticker as the round countdown (`app/duel/[market]/pulse/[matchId]/page.tsx:121-127`).
- `expireLocksIfDue` (`lib/match.ts:80`), run lazily by the poll, always starts the round dated to the 5s deadline, even when neither player has traded.

## Countdown

- Length is per-match: `timerSeconds`, 10–3600s, chosen in the lobby (`app/api/match/find-or-create/route.ts:11-15`). Solo Pulse keeps its own constant.
- Deadline is `roundStartAt + timerSeconds`, computed server-side (`lib/match.ts:25`) and sent with every view.
- The client subtracts clock skew (`serverNow` minus local `Date.now()`) before using it (`app/duel/[market]/pulse/[matchId]/page.tsx:55-62`), then recomputes `ceil((deadline-now)/1000)` every 200ms (`app/duel/[market]/pulse/[matchId]/page.tsx:121-127`). Immune to tab throttling and to a server in another timezone.
- Hitting 0 does nothing locally — settlement is the server's, triggered by whichever poll first arrives past the deadline.

## settleIfDue(row) — `lib/match.ts:98`

1. No-ops unless `status='countdown'` and the deadline has passed (`:99-101`).
2. `getSpotPrice()` walks Coinbase Exchange ticker → Coinbase spot → Binance (`lib/spotPrice.ts:47`).
3. Remaining positions close at that price; `profit{N}` = realized + their P&L (`:108-114`).
4. Winner = higher profit; equal → tie (`:115`).
5. Written under `status='countdown'` (`:116-130`), so two simultaneous polls cannot double-settle — the loser re-reads and uses the winner's values (`:132`).
6. On price-source failure the row stays in `countdown` and the next poll retries (`:103-106`); nothing is lost, but nothing tells the player either (see roadmap.md).

Runs on `expireLocksIfDue`'s result, not on the raw row (`app/api/match/[id]/route.ts:38`) — expiry can hand back a `countdown` row.

Ties only occur on exactly equal P&L (`lib/match.ts:115`).

## Play again

Both players enter server-priced long/short positions during `countdown`; `POST /api/match/[id]/action`
guards close/reverse mutations during `countdown`, and `settleIfDue` closes
remaining positions, realizes their P&L, then compares the two final leveraged
P&Ls at the server settlement price.

Multiplayer Pulse allows unlimited long/short entries during `countdown`. Each
entry is an independent position; closing one realizes its P&L without changing
the others. There is no in-place reset: a round is a row, so "Play Again" is a link back to
the lobby and the next match is a new row. The client
freezes its chart snapshot once, on first seeing a priced `settled`, with the
final point pinned to the deadline rather than to whenever the tab noticed
(`app/duel/[market]/pulse/[matchId]/page.tsx:132`), and stops polling (`:106`).

## Known non-behaviors (see roadmap.md for detail)

- A `predict` match whose opponent walks away still starts after 5s and settles on P&L. An `open` one still needs Cancel or presence expiry.
- `wager` is reserved from each signed-in player's balance on match entry, refunded for pre-round exits/ties, and paid as a 2× pot to the winner via the idempotent payout ledger (`lib/balance.ts`, `db/schema.ts`).
- No cross-round score or history; `matches` rows accumulate with no cleanup.
