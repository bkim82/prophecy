import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";
import type { PulsePosition } from "@/lib/pulse";

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

// One row per networked match — the single source of truth for Quick Play and
// Pulse rounds. `status` mirrors the client-side `Phase` vocabulary in docs/game-loop.md
// so the mental model is unchanged, only who owns it.
//   open --(p2 joins)--> predict --(both ready | 15s lock window)--> countdown --(deadline)--> settled
// Player ids are anonymous per-browser UUIDs (app/lib/playerId.ts), not Clerk ids.
export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  market: text("market").notNull(), // "btc" | "eth"
  mode: text("mode").notNull(), // "quick-play" | "pulse"
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
  // Pulse keeps each player's position set and realized P&L in the match row
  // so a reload or a second tab cannot invent a different position.
  pulseReady1: boolean("pulse_ready1").notNull().default(false),
  pulseReady2: boolean("pulse_ready2").notNull().default(false),
  pulseSide1: text("pulse_side1"), // "long" | "short"
  pulseSide2: text("pulse_side2"),
  pulseEntryPrice1: doublePrecision("pulse_entry_price1"),
  pulseEntryPrice2: doublePrecision("pulse_entry_price2"),
  pulseStake1: doublePrecision("pulse_stake1"),
  pulseStake2: doublePrecision("pulse_stake2"),
  pulseLeverage1: integer("pulse_leverage1"),
  pulseLeverage2: integer("pulse_leverage2"),
  pulseRealizedPnl1: doublePrecision("pulse_realized_pnl1"),
  pulseRealizedPnl2: doublePrecision("pulse_realized_pnl2"),
  pulsePositions1: jsonb("pulse_positions1").$type<PulsePosition[]>(),
  pulsePositions2: jsonb("pulse_positions2").$type<PulsePosition[]>(),
  pulseProfit1: doublePrecision("pulse_profit1"),
  pulseProfit2: doublePrecision("pulse_profit2"),
  roundStartAt: timestamp("round_start_at", { withTimezone: true }),
  finalPrice: doublePrecision("final_price"),
  winner: text("winner"), // "1" | "2" | "tie"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const readingPayouts = pgTable("reading_payouts", {
  id: text("id").primaryKey(), // = reading id, one payout per settled reading
  readingId: text("reading_id").notNull(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(),
});

// One row per 24h Reading call: a solo leveraged long/short wager, no
// opponent and no manual close. Windows reset every 6 hours at 00:00/06:00/
// 12:00/18:00 in the *caller's own local time*, not a shared UTC clock — the
// boundaries are computed once at creation from a client-reported timezone
// offset and stored as absolute instants (lib/reading.ts readingWindowFor).
// `id` is deterministic (`${userId}:${market}:${windowStartAt epoch ms}`), so
// a second call attempt in the same window collides on insert rather than
// needing a read-then-write check.
export const readings = pgTable("readings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  market: text("market").notNull(), // "btc" | "eth"
  side: text("side").notNull(), // "long" | "short"
  wager: integer("wager").notNull(),
  leverage: integer("leverage").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  windowStartAt: timestamp("window_start_at", { withTimezone: true }).notNull(),
  windowEndAt: timestamp("window_end_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"), // "open" | "settled"
  exitPrice: doublePrecision("exit_price"),
  pnl: integer("pnl"), // embers; realized loss floored at -wager, same stop-out as Pulse
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
