# Roadmap

What the prototype deliberately does not do, and what each gap would actually take. Nothing here is a bug report — these are the edges of a prototype that was scoped to prove the core loop.

## Not built

**Two players, one browser.** Both predictions are typed on the same keyboard, so each player can see the other's guess before locking, and the first to lock can watch the price move while the second decides. Making this fair needs either hidden inputs and a commit step, or genuine networking.

**No networking.** There is no room, no matchmaking, no second client. Real multiplayer means a server holding round state, which is the one thing the current design avoids entirely — `/api/price` and `/api/history` are stateless proxies today.

**No persistence.** Reloading the page loses everything. There is no score across rounds, no history of past duels, and no identity for a player. Nothing is stored anywhere.

**No stakes.** Predictions cost nothing and winning pays nothing.

**Fixed round length.** `ROUND_SECONDS` is hard-coded to 60 (`app/page.tsx:7`). Making it configurable is a small change, but it touches the chart's window: a round longer than `WINDOW_MS` (3 minutes) would start scrolling off the left edge of the chart before it settles.

**BTC/USD only.** The pair is hard-coded in three places — the socket subscription (`app/usePriceFeed.ts:79`), both REST sources (`app/api/price/route.ts:13`, `:18`), and both history sources (`app/api/history/route.ts:19`, `:47`). Supporting another asset means threading a symbol through all of them, and the two REST sources spell pairs differently (`BTC-USD` vs `BTCUSDT`).

## Quality gaps

**No tests.** There are no test files and no `test` script. The pieces most worth covering are pure and easy to test in isolation: the bucketing in `fromTrades`, the `trim` window logic, the live-edge merge in `points`, and the winner calculation.

**No lint script.** `package.json` has `dev`, `build`, and `start` only.

**No CI.** No `.github/workflows`; nothing runs on push.

**No error boundary.** A throw inside the page takes the whole app to the Next.js error screen mid-round.

## Smaller things

**Ties are exact-match only.** `winner` is decided by `diff1 === diff2` on floats (`app/page.tsx:75`), so a tie in practice requires both players to type the identical number. That is what the UI claims, so it is consistent — but a "within $1 is a draw" rule would need a tolerance instead.

**Countdown starts a beat after the lock.** `roundStart` is stamped inside `lock()` and the deadline is computed later, when the countdown effect runs (`app/page.tsx:117` vs `:89`). The gap is one render, so the shaded band and the timer are off by a few milliseconds — invisible today, but worth folding into one timestamp if round timing ever becomes authoritative.

**Light mode only.** Colours are hard-coded in both the page and the chart; there is no dark palette and no `prefers-color-scheme` handling.

**No hover on the chart.** There is no tooltip, crosshair, or way to read the price at an arbitrary point in the window.

**A stale seed can outrun the socket.** If `/api/history` is slow, its response can land after the socket has already committed points. The merge sorts by timestamp and trims (`app/usePriceFeed.ts:48`), so the result is correct, but the chart visibly re-draws when it arrives.

## Natural next step

If this goes further, the fork in the road is networking. Everything above is cheap except real multiplayer, and real multiplayer changes the architecture: round state moves to the server, settlement stops being a client-side fetch, and `/api/price` becomes the authority rather than a fallback. Worth deciding before adding scores or stakes, both of which would need rewriting once a server owns the round.
