# game-loop

All in `app/page.tsx`. No reducer, no state lib — `phase` string + `useState` values.

## Phases

```
predict --(both locked)--> countdown --(0s)--> settling --> result
   ^                                             |(err: retry)   |
   +--------------------- play again ------------------------------+
```

`type Phase = "predict" | "countdown" | "settling" | "result"` (`app/page.tsx:12`)

| Phase | State |
| --- | --- |
| `predict` | inputs enabled, chart live |
| `countdown` | predictions locked+immutable, timer visible, chart shaded from `roundStart` |
| `settling` | fetching final price; failure → retry button, round not lost |
| `result` | winner shown, chart frozen, per-player breakdown |

## lock(player) — `app/page.tsx:107-129`

- Active only in `predict`.
- Rejects non-finite or ≤0 values.
- Computes both predictions' post-lock state (not stale reads) before starting round (`:115-127`) — avoids stale-state bug on 2nd lock.
- One `at = Date.now()` per call (`:114`) feeds both `lockedAt{1,2}` and `roundStart`, so the 2nd lock's chart marker sits exactly on the round-band edge.
- `lockedAt1` / `lockedAt2` (`:40-41`) → `PredictionLine.at`, drawn as vertical lock markers (`:150-154`, see chart.md).
- Stamps `roundStart = at` (chart shading anchor).
- Either player may lock first, order irrelevant. Locked input disabled+shows value (`:263`, `:268`). Enter key = lock (`:265-267`).

## Countdown

- `ROUND_SECONDS = 60` (`app/page.tsx:7`).
- Fixed deadline computed once at effect start, not decremented — recomputes `ceil((deadline-now)/1000)` every 200ms (`:92-102`). Immune to tab throttling/missed ticks.
- At 0 → clear interval, call `settle()` exactly once.

## settle(p1, p2) — `app/page.tsx:53-86`

1. `getLivePrice()` if fresh (<5s), else `fetch(/api/price)` (throws on non-ok).
2. `diff1`, `diff2` = abs distance from settled price.
3. Freeze chart: snapshot series + final point (`:68-71`).
4. Winner = smaller diff; equal → tie (`:78`).
5. On failure: phase stays `settling`, `settleError` set, Retry button re-runs `settle` with same locked values (`:209-216`).
6. Chart reads from ref (not render-time `points`) so snapshot has latest series despite `settle` being memoized (`:50-51`).

Ties only occur on exact-match input (abs diff, floats) (`:78`) — matches UI copy "Tie — identical predictions."

## playAgain() — `app/page.tsx:131-144`

Clears all round state (12 fields). Feed/socket untouched — chart history persists across rounds.

## Known non-behaviors (see roadmap.md for detail)

- Both players share one keyboard/input — no hidden entry.
- No cross-round score, stake, or history.
