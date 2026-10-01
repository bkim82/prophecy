import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

// One row per networked match — the single source of truth for multiplayer
// Pulse rounds. `status` mirrors the client-side `Phase` vocabulary in docs/game-loop.md
// so the mental model is unchanged, only who owns it.
//   open --(p2 joins)--> predict --(5s pre-round countdown)--> countdown --(deadline)--> settled
// Player ids are anonymous per-browser UUIDs (app/lib/playerId.ts), not Clerk ids.
export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  market: text("market").notNull(), // "btc" | "eth"
  mode: text("mode").notNull(), // "pulse"
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
  // Presence only gates matchmaking/listing pre-round; see lib/match.ts PRESENCE_MS.
  player1LastSeen: timestamp("player1_last_seen", { withTimezone: true }).notNull().defaultNow(),
  player2LastSeen: timestamp("player2_last_seen", { withTimezone: true }),
  // Stamped when player 2 joins: the `predict` phase is a hard 5s window
  // (lib/match.ts PULSE_START_SECONDS), not an untimed wait for both players.
  predictStartAt: timestamp("predict_start_at", { withTimezone: true }),
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

// One row per 24h portfolio session. `endAt = startAt + 24h`, computed once
// at creation and stored as an absolute instant — never recomputed from a
// later clock read, same rule the retired `readingWindowFor` followed.
// `committedCash`/`realizedPnl` are running totals mutated only via
// scalar-arithmetic guarded UPDATEs (lib/balance.ts reserveBalance/
// refundBalance idiom) — Postgres serializes concurrent single-row UPDATEs
// so no transaction is needed (db/index.ts's neon-http driver has none).
// Buying power is always derived: startingBalance - committedCash + realizedPnl
// (lib/portfolioRules.ts availableCash).
export const portfolioSessions = pgTable("portfolio_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  startingBalance: integer("starting_balance").notNull(),
  committedCash: integer("committed_cash").notNull().default(0),
  realizedPnl: integer("realized_pnl").notNull().default(0),
  status: text("status").notNull().default("active"), // "active" | "settled"
  startAt: timestamp("start_at", { withTimezone: true }).notNull().defaultNow(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Enforces "one active session per user" as a single guarded INSERT
  // (`ON CONFLICT DO NOTHING` against this index), never a read-then-insert.
  oneActivePerUser: uniqueIndex("portfolio_sessions_one_active_per_user")
    .on(table.userId)
    .where(sql`${table.status} = 'active'`),
}));

// One row per position, either shape, discriminated by `kind`. Spot uses
// qty+entryPrice (ownership, valued mark-to-market); leverage uses
// committedCash+leverage+side (directional wager, same P&L shape the retired
// readings.pnl formula used). No averaging, no partial close — every
// buy/long/short is its own lot, closing always closes it entirely, same
// all-or-nothing shape as lib/pulse.ts PulsePosition.
export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull(), // denormalized for cross-session history queries
  kind: text("kind").notNull(), // "spot" | "leverage"
  tokenAddress: text("token_address").notNull(), // lowercased Base contract address
  tokenSymbol: text("token_symbol").notNull(), // denormalized at open time — never re-looked-up for history
  tokenName: text("token_name").notNull(),
  side: text("side"), // "long" | "short" — leverage only, null for spot
  leverage: integer("leverage"), // 1|2|3|5 — leverage only, null for spot (spot is implicitly 1x)
  qty: doublePrecision("qty"), // spot only — token quantity owned; null for leverage
  entryPrice: doublePrecision("entry_price").notNull(),
  committedCash: integer("committed_cash").notNull(), // embers locked: spot cost basis or leverage margin
  status: text("status").notNull().default("open"), // "open" | "closed"
  exitPrice: doublePrecision("exit_price"),
  realizedPnl: integer("realized_pnl"), // embers, null until closed, floored at -committedCash
  closeReason: text("close_reason"), // "manual" | "session_end"
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// Idempotent payout ledger, same shape as lib/balance.ts creditPayout.
export const portfolioPayouts = pgTable("portfolio_payouts", {
  id: text("id").primaryKey(), // = session id, one payout per settled session
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(),
});
