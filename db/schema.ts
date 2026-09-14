import {
  pgTable,
  text,
  integer,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  balance: integer("balance").notNull().default(1000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const matchPayouts = pgTable("match_payouts", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(),
});

// One row per Quick Play match — the single source of truth for a networked
// round. `status` mirrors the client-side `Phase` vocabulary in docs/game-loop.md
// so the mental model is unchanged, only who owns it.
//   open --(p2 joins)--> predict --(both locked | 15s lock window)--> countdown --(deadline)--> settled
// Player ids are anonymous per-browser UUIDs (app/lib/playerId.ts), not Clerk ids.
export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  market: text("market").notNull(), // "btc" | "eth"
  mode: text("mode").notNull(), // "quick-play" for now
  wager: integer("wager").notNull(),
  timerSeconds: integer("timer_seconds").notNull(),
  status: text("status").notNull().default("open"),
  player1Id: text("player1_id").notNull(),
  player2Id: text("player2_id"),
  player1UserId: text("player1_user_id"),
  player2UserId: text("player2_user_id"),
  // Every timestamp here is `timestamptz`, not the bare `timestamp` `users`
  // uses: these are compared against wall-clock `Date.now()` and written from
  // more than one code path. A naive column stores whatever local time the
  // writer happened to be in, so a row written from a laptop and read on a UTC
  // server lands hours out — which reads as "that player went offline".
  // Presence only gates matchmaking/listing pre-lock; see lib/match.ts PRESENCE_MS.
  player1LastSeen: timestamp("player1_last_seen", { withTimezone: true }).notNull().defaultNow(),
  player2LastSeen: timestamp("player2_last_seen", { withTimezone: true }),
  // Stamped when player 2 joins: the `predict` phase is a hard 15s window
  // (lib/match.ts LOCK_SECONDS), not an untimed wait for both players.
  predictStartAt: timestamp("predict_start_at", { withTimezone: true }),
  prediction1: doublePrecision("prediction1"),
  prediction2: doublePrecision("prediction2"),
  lockedAt1: timestamp("locked_at1", { withTimezone: true }),
  lockedAt2: timestamp("locked_at2", { withTimezone: true }),
  roundStartAt: timestamp("round_start_at", { withTimezone: true }),
  finalPrice: doublePrecision("final_price"),
  winner: text("winner"), // "1" | "2" | "tie"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
