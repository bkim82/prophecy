# Game loop

All of it lives in `app/page.tsx`. There is no reducer and no state library — the round is a `phase` string plus a handful of `useState` values.

## Phases

```
predict ──(both players locked)──> countdown ──(0s)──> settling ──> result
   ▲                                                       │           │
   │                                                  (error: retry)   │
   └──────────────────── play again ───────────────────────────────────┘
```

`type Phase = "predict" | "countdown" | "settling" | "result"` (`app/page.tsx:12`).

| Phase | What is true |
| --- | --- |
| `predict` | Inputs enabled, no round running, chart is live |
| `countdown` | Both predictions locked and immutable, timer visible, chart shaded from `roundStart` |
| `settling` | Fetching the final price; a failure here shows a retry button rather than losing the round |
| `result` | Winner shown, chart frozen, per-player breakdown rendered |

## Locking

`lock(player)` (`app/page.tsx:104-120`) only acts during `predict`. It rejects anything that is not a finite number greater than zero, so blanks and negatives cannot be locked.

It computes what *both* predictions would be after this lock, rather than reading state it just set, and only starts the round when both are non-null (`app/page.tsx:111-119`). That avoids a stale-state read on the second player's lock.

Locking stamps `roundStart = Date.now()`, which the chart uses to shade the live round.

Either player can lock first; order does not matter. A locked input becomes disabled and displays the locked value (`app/page.tsx:252`, `:257`). Enter in the input locks, same as the button (`app/page.tsx:254-256`).

## Countdown

`ROUND_SECONDS` is 60 (`app/page.tsx:7`).

The timer runs against a **fixed deadline** computed once when the effect starts, not by decrementing a counter (`app/page.tsx:89`). The interval fires every 200ms and recomputes `ceil((deadline - now) / 1000)` (`app/page.tsx:90-99`). This means the display stays accurate even if the tab is throttled or a tick is missed — a decrementing counter would silently drift.

At zero the interval is cleared and `settle()` fires exactly once.

## Settlement

`settle(p1, p2)` (`app/page.tsx:50-83`):

1. Prefer the live socket tick via `getLivePrice()` — but only if it is fresher than 5s.
2. If that returns `null`, fetch `/api/price`. A non-ok response throws.
3. Compute `diff1` and `diff2` as absolute distances from the final price.
4. Freeze the chart by snapshotting the current series plus a final point at the settled price (`app/page.tsx:65-68`).
5. Winner is whoever has the smaller diff; equal diffs are a tie (`app/page.tsx:75`).

Because the diffs are absolute values, a tie can only happen when both players entered the same number — which is why the UI says "Tie — identical predictions" (`app/page.tsx:304-306`).

On failure the phase stays `settling`, `settleError` is set, and a **Retry** button re-runs `settle` with the same locked predictions (`app/page.tsx:198-205`). The round is never lost to a transient network error.

The chart reads from a ref rather than the render-time `points`, so the snapshot captures the latest series even though `settle` is a memoized callback (`app/page.tsx:47-48`).

## Reset

`playAgain()` (`app/page.tsx:122-133`) clears all ten pieces of round state. The price feed is untouched — the socket stays connected and the chart keeps its history across rounds, so a new round starts with a populated chart.

## What the game does not do

Both players use the same keyboard, so predictions are visible to each other and nothing stops one player from editing before locking. There is no score across rounds, no stake, and no record of past duels. See the [roadmap](roadmap.md).
