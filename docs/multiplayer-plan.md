# Multiplayer implementation plan — Quick Play

Status: planned, not yet built. This is a forward-looking implementation
plan (narrative, unlike the fact-sheet docs it sits next to) — update or
replace it as the design changes, and fold the settled parts into
`architecture.md`/`game-loop.md`/`roadmap.md` once shipped, per the docs
orchestration rule in `AGENTS.md`.

## Context

Quick Play (`app/duel/btc/quick-play/page.tsx`) is currently a same-browser
hot-seat demo: one page, two input boxes, no networking. `roadmap.md` calls
this out explicitly as "the next fork" — real multiplayer needs server-held
round state, and everything else (stakes, balance) should wait until that
exists. This plan builds that fork: the lobby's wager/timer controls
(`app/page.tsx`) start matching players over the network instead of handing
both inputs to one keyboard.

Scope: no balance deduction, no required sign-in (anonymous per-browser
identity), and Quick Play's hot-seat page is **replaced** — it becomes the
real networked mode, not an alternate option. Persistence should be the
cheapest option available: the app already has a provisioned Neon Postgres
database (`db/index.ts`, `db/schema.ts`) — reuse it instead of adding
Redis/KV. Sync is via short-interval polling (~1s) against that DB, reusing
the fixed-deadline countdown pattern the app already uses in
`quick-play/page.tsx:107-123`, rather than building a WebSocket connection
registry for an MVP.

## Match lifecycle

A `matches` row is the single source of truth. Status mirrors the existing
`Phase` vocabulary from `game-loop.md` so the mental model doesn't change,
just who's authoritative for it:

```
open --(player2 joins)--> predict --(both locked)--> countdown --(deadline)--> settled
 |                            |
 (creator leaves/expires)     (either player leaves)
 |                            |
 v                            v
(row deleted)              (row deleted)
```

- **open** — player1 created it, waiting for an opponent. Matches with the
  same `(market, mode, wager, timerSeconds)` can auto-join here; anyone can
  also join a specific one from the lobby's Open Matches list.
- **predict** — both players present, neither prediction locked yet. No
  timer — mirrors today's untimed "type your guess" phase. Either player can
  bail via Leave, which deletes the match (the other player's next poll gets
  "not found" and returns to lobby).
- **countdown** — both predictions locked (hidden from each other), timer
  running from `roundStartAt` for `timerSeconds`. Once both players have
  locked, the match no longer depends on anyone staying online — settlement
  only needs the two stored predictions plus a spot price at the deadline.
- **settled** — final price + both predictions (now revealed) + winner
  stored once, idempotently, by whichever poll request first notices
  `now() >= deadline`.

**Presence** only matters pre-lock, which is also the only place "persist
only while online" applies: an `open` match is excluded from
matching/listing once its creator's heartbeat is older than 8s (no cron, no
cleanup job — a dead row is just invisible and gets naturally replaced by the
next player's own `open` insert). During `predict`, both players heartbeat so
the UI can show "opponent disconnected" and offer Leave, but there's no
auto-timeout — that's an accepted MVP gap, to be noted in `roadmap.md` like
its other documented gaps.

## Data model

Add to `db/schema.ts` (integer wager mirrors `users.balance`'s style):

```ts
export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),           // "btc" | "eth"
  mode: text("mode").notNull(),                // "quick-play" for MVP
  wager: integer("wager").notNull(),
  timerSeconds: integer("timer_seconds").notNull(),
  status: text("status").notNull().default("open"), // open|predict|countdown|settled
  player1Id: text("player1_id").notNull(),
  player2Id: text("player2_id"),
  player1LastSeen: timestamp("player1_last_seen").notNull().defaultNow(),
  player2LastSeen: timestamp("player2_last_seen"),
  prediction1: doublePrecision("prediction1"),
  prediction2: doublePrecision("prediction2"),
  lockedAt1: timestamp("locked_at1"),
  lockedAt2: timestamp("locked_at2"),
  roundStartAt: timestamp("round_start_at"),
  finalPrice: doublePrecision("final_price"),
  winner: text("winner"),                      // "1" | "2" | "tie"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Run `drizzle-kit push` (or generate+migrate, matching however `users` was set
up) to apply it.

## Concurrency without transactions

`db/index.ts` uses `drizzle-orm/neon-http`, which sends one HTTP request per
statement — no multi-statement transactions or row locks. Every state
transition is instead a single atomic `UPDATE ... WHERE <guard> RETURNING *`,
which Postgres already makes race-safe on its own:

- Auto-match: `SELECT` a candidate `open` row, then
  `UPDATE matches SET player2_id=$id, status='predict' WHERE id=$id AND status='open' AND player2_id IS NULL RETURNING *`.
  0 rows back = someone else grabbed it first → retry the search once, then
  fall back to creating a new `open` row.
- Lock: `UPDATE matches SET prediction{N}=$v, locked_at{N}=now() WHERE id=$id AND status='predict' AND prediction{N} IS NULL RETURNING *`;
  if the returned row now has both predictions non-null, a second guarded
  `UPDATE ... SET status='countdown', round_start_at=now() WHERE id=$id AND status='predict'`
  makes the transition exactly once (only the request that completed the 2nd
  lock sees both non-null).
- Settle: `UPDATE matches SET status='settled', final_price=$p, winner=$w WHERE id=$id AND status='countdown' RETURNING *` —
  safe even if both players' polls race to trigger it.

## New files

- `lib/spotPrice.ts` — extract the Coinbase→Binance fallback chain out of
  `app/api/price/route.ts:13-24,33-46` into `getSpotPrice(product: string): Promise<number>`.
  Reused by the existing route (unchanged behavior) and by match settlement,
  so there's one source of truth for "how do we get a settlement price."
- `app/lib/playerId.ts` — client-only helper: read `localStorage.playerId`,
  generate+store `crypto.randomUUID()` if absent. No server session route.
- `app/api/match/find-or-create/route.ts` — POST, body
  `{ playerId, market, mode, wager, timerSeconds }` → `{ matchId }`.
- `app/api/match/[id]/join/route.ts` — POST `{ playerId }`, same atomic-update
  helper as above but targeted at a specific id (the "browse list" path).
- `app/api/match/[id]/route.ts` — GET `?playerId=` → role-scoped state
  (opponent's prediction/value withheld until `settled`); performs lazy
  settlement inline when `status==='countdown'` and the deadline has passed.
- `app/api/match/[id]/lock/route.ts` — POST `{ playerId, prediction }`.
- `app/api/match/[id]/heartbeat/route.ts` — POST `{ playerId }`.
- `app/api/match/[id]/leave/route.ts` — POST `{ playerId }`; deletes the row
  if status is `open` or `predict` (no-op / 409 once `countdown` has started).
- `app/api/match/open/route.ts` — GET `?market=&mode=` → list of joinable
  `open` matches (id, market, mode, wager, timerSeconds, createdAt) with a
  fresh creator heartbeat, for the lobby's Open Matches panel.
- `app/duel/[market]/match/[matchId]/page.tsx` — the match room. Replaces
  `app/duel/btc/quick-play/page.tsx` (deleted). Polls `GET /api/match/[matchId]`
  every ~1s and renders by `status`:
  - `open` (you're player1): "Waiting for an opponent…" + Cancel (→ leave).
  - `predict`: single-sided prediction input + Lock button (reuses the
    existing input/nudge markup from the old page, one column instead of
    two); shows "opponent disconnected" + Leave when `opponentPresent` is
    false.
  - `countdown`: existing fixed-deadline countdown UI, driven by
    `roundStartAt`/`timerSeconds` from the server instead of local state;
    shows "Locked at $X — waiting on opponent" with the opponent's value
    still hidden.
  - `settled`: existing result panel, now fed from server data (both
    predictions revealed, diffs, winner). "Play Again" routes back to `/`.
  - `<PriceChart>` keeps using the browser's own `usePriceFeed()` exactly as
    today (chart stays client-direct to Coinbase, no server round-trip) —
    only `roundStart`/lock-marker timestamps now come from the poll instead
    of local `lock()` state.

## Changed files

- `app/page.tsx`:
  - Quick Play's Play button (`playHref`/`isPlayable` block around
    `app/page.tsx:103-105,171-173`) becomes an async `onClick` for
    `mode==='quick-play'`: POST `find-or-create` with the player id, wager,
    timer, market, then `router.push` to the new match route. Pulse and the
    24hr Battle placeholder are untouched.
  - The hardcoded `openMatches` array (`app/page.tsx:51-55`) is replaced by
    data from `GET /api/match/open`, polled every few seconds while Quick
    Play is selected; each row's existing markup gains a join action that
    posts to `.../join` then routes the same way.

## Docs follow-up (per AGENTS.md orchestration rule)

After the code lands, targeted edits (not rewrites):
- `roadmap.md` — remove/close the "No networking" and "Same-browser 2P"
  rows; add rows for what's still genuinely open: no auto-timeout on an
  abandoned `predict` match, no stakes/balance deduction, no cleanup cron for
  the (self-filtering but ever-growing) `matches` table.
- `architecture.md` — module map gains the new API routes and match page,
  drops the retired quick-play hot-seat page, updates the "No DB, no
  server-side game state" line in `README.md:12` (now false for Quick Play
  specifically).
- `game-loop.md` — phase machine is now server-authoritative for Quick Play;
  note the `open`/`predict`/`countdown`/`settled` statuses map onto the same
  phases, just owned by `matches` rows instead of `page.tsx` state.

## Verification

1. `npm run dev`, open two separate browser identities (e.g. one normal
   window + one incognito — identity is per-`localStorage`).
2. Both pick BTC Quick Play with the same wager/timer and press Play: first
   creates an `open` match (visible in the other's Open Matches list within
   one poll cycle); second auto-matches into it, both land in the match room.
3. Confirm predictions stay hidden from the opponent until settle, the
   countdown only starts after both lock, the winner/diff calc matches
   today's logic, and the chart's round-band/lock markers render correctly.
4. Manual path: a third browser browses Open Matches and joins a specific
   row instead of matching by criteria — confirm it lands in that exact
   match.
5. Abandonment: create an `open` match, close that tab, confirm it drops out
   of Open Matches / stops being auto-matchable after ~8-10s, and a fresh
   browser with the same criteria creates its own match instead of joining
   the dead one.
6. `predict`-phase leave: one player leaves before locking — confirm the
   other's next poll reports the match gone and returns them to the lobby.
