import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  check,
  index,
  numeric,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PulsePosition } from "@/lib/pulse";
import type { BotState } from "@/lib/bots";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk during transition; stable CDP end-user id after reset
  balance: integer("balance").notNull().default(1000),
  // Nullable only while Clerk-backed rows coexist before the Phase 2 reset.
  smartAccountAddress: text("smart_account_address"),
  ownerAddress: text("owner_address"),
  walletChainId: integer("wallet_chain_id"),
  walletStatus: text("wallet_status"), // "active" | "locked" | "deleted"
  walletCreatedAt: timestamp("wallet_created_at", { withTimezone: true }),
  walletUpdatedAt: timestamp("wallet_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_smart_account_address_unique").on(table.smartAccountAddress),
  check(
    "users_wallet_chain_id_base",
    sql`${table.walletChainId} IS NULL OR ${table.walletChainId} = 8453`,
  ),
  check(
    "users_wallet_status_valid",
    sql`${table.walletStatus} IS NULL OR ${table.walletStatus} IN ('active', 'locked', 'deleted')`,
  ),
]);

// Only the opaque token is sent to the browser. Its keyed hash is the primary
// key here, so a database read cannot be replayed as an application session.
export const appSessions = pgTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
}, (table) => [
  index("app_sessions_user_id_idx").on(table.userId),
  index("app_sessions_expiry_idx").on(table.expiresAt),
  check("app_sessions_expiry_order", sql`${table.expiresAt} > ${table.issuedAt}`),
  check("app_sessions_idle_expiry_order", sql`${table.idleExpiresAt} > ${table.issuedAt}`),
]);

// Fixed-window request limits are claimed with one INSERT ... ON CONFLICT
// statement. Subjects are keyed hashes, never raw IP addresses or user ids.
export const requestRateLimits = pgTable("request_rate_limits", {
  scopeKey: text("scope_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, (table) => [
  check("request_rate_limits_positive_count", sql`${table.count} > 0`),
]);

// Durable embedded-wallet operations. Every amount is stored as an integer
// decimal string (numeric(78,0)); browser display values are never persisted.
export const transactionIntents = pgTable("transaction_intents", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  userId: text("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  kind: text("kind").notNull(), // "send" | "swap"
  chainId: integer("chain_id").notNull(),
  smartAccountAddress: text("smart_account_address").notNull(),
  tokenIn: text("token_in").notNull(),
  tokenOut: text("token_out"),
  recipient: text("recipient").notNull(),
  inputAmount: numeric("input_amount", { precision: 78, scale: 0 }).notNull(),
  minimumOutputAmount: numeric("minimum_output_amount", { precision: 78, scale: 0 }),
  quoteProvider: text("quote_provider"),
  quoteId: text("quote_id"),
  quoteExpiresAt: timestamp("quote_expires_at", { withTimezone: true }),
  calls: jsonb("calls").$type<Array<{ to: string; value: string; data: string }>>().notNull(),
  normalizedCallHash: text("normalized_call_hash").notNull(),
  userOperationHash: text("user_operation_hash"),
  transactionHash: text("transaction_hash"),
  status: text("status").notNull().default("created"),
  failureCode: text("failure_code"),
  submissionClaimedAt: timestamp("submission_claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("transaction_intents_user_idempotency_unique")
    .on(table.userId, table.idempotencyKey),
  index("transaction_intents_user_created_idx").on(table.userId, table.createdAt),
  index("transaction_intents_reconcile_idx").on(table.status, table.updatedAt),
  check("transaction_intents_chain_base", sql`${table.chainId} = 8453`),
  check("transaction_intents_kind_valid", sql`${table.kind} IN ('send', 'swap')`),
  check(
    "transaction_intents_status_valid",
    sql`${table.status} IN ('created', 'confirmed_by_user', 'submitted', 'included', 'reverted', 'dropped', 'replaced', 'canceled')`,
  ),
  check("transaction_intents_input_positive", sql`${table.inputAmount} > 0`),
]);

// One guarded UPSERT increments raw sponsored value per user/token/day.
export const walletSpendCounters = pgTable("wallet_spend_counters", {
  scopeKey: text("scope_key").primaryKey(),
  userId: text("user_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  dayStartedAt: timestamp("day_started_at", { withTimezone: true }).notNull(),
  rawAmount: numeric("raw_amount", { precision: 78, scale: 0 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("wallet_spend_counters_user_day_idx").on(table.userId, table.dayStartedAt),
  check("wallet_spend_counters_nonnegative", sql`${table.rawAmount} >= 0`),
]);

// Security-relevant actions only; detail is deliberately small and excludes
// tokens, cookies, private material, full calldata, and provider responses.
export const walletAuditEvents = pgTable("wallet_audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  event: text("event").notNull(),
  targetId: text("target_id"),
  detail: jsonb("detail").$type<Record<string, string | number | boolean | null>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("wallet_audit_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const onrampOrders = pgTable("onramp_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  smartAccountAddress: text("smart_account_address").notNull(),
  asset: text("asset").notNull(),
  providerOrderId: text("provider_order_id"),
  status: text("status").notNull().default("created"),
  providerUrl: text("provider_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  transactionHash: text("transaction_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("onramp_orders_user_created_idx").on(table.userId, table.createdAt),
  check(
    "onramp_orders_status_valid",
    sql`${table.status} IN ('created', 'pending', 'completed', 'failed', 'abandoned', 'refunded')`,
  ),
]);

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
  market: text("market").notNull(), // "btc" | "eth" | "hype"
  mode: text("mode").notNull(), // "pulse"
  wager: integer("wager").notNull(),
  timerSeconds: integer("timer_seconds").notNull(),
  status: text("status").notNull().default("open"),
  player1Id: text("player1_id").notNull(),
  player2Id: text("player2_id"),
  player1UserId: text("player1_user_id"),
  player2UserId: text("player2_user_id"),
  // A challenge's private round (app/profile/challengeActions.ts acceptChallenge):
  // only this account may take seat 2, and the lobby list, matchmaking and
  // house bots all skip it.
  invitedUserId: text("invited_user_id"),
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
  // Non-null when one seat is a house bot (lib/bots.ts): which role it plays
  // and its per-round decision state. Never sent to clients.
  botState: jsonb("bot_state").$type<BotState>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // One bot-hosted waiting match per lobby slot, so concurrent
  // `ensureBotSlots` calls can't stack duplicates (`ON CONFLICT DO NOTHING`).
  oneOpenBotPerSlot: uniqueIndex("matches_one_open_bot_per_slot")
    .on(table.market, table.mode, table.wager, table.timerSeconds)
    .where(sql`${table.status} = 'open' AND ${table.botState} IS NOT NULL`),
}));

// House-bot personas (lib/bots.ts). `id` is Clerk-shaped and lands in
// `matches.player{N}_user_id` like a real user's; `name` is what
// lib/opponentNames.ts shows. `skill` (0 reckless .. 1 disciplined) shapes
// trading habits and is never exposed. Bots have no `users` row, so payouts
// to a bot are no-ops.
export const bots = pgTable("bots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  skill: doublePrecision("skill").notNull(),
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

// One row per application user who has edited their profile (/profile's Edit
// profile dialog, app/profile/actions.ts). Avatar and banner image bytes are
// owned by Prophecy so they survive the auth-provider transition.
// `handle` is stored lowercase without the "@"; NULLs don't collide in a
// Postgres unique index, so any number of users can have no handle. The
// banner is either a preset id (app/lib/profileEdit.ts BANNER_PRESETS) or an
// uploaded image (base64, ≤ BANNER_MAX_BYTES decoded), never both — served
// by GET /api/profile/banner rather than inlined into the page.
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name"),
  handle: text("handle"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  bannerPreset: text("banner_preset"),
  bannerImage: text("banner_image"),
  bannerMime: text("banner_mime"),
  avatarImage: text("avatar_image"),
  avatarMime: text("avatar_mime"),
  // Highlight reel: up to 3 won `matches` ids, in pin order (app/profile/actions.ts togglePinnedMatch).
  pinnedMatches: jsonb("pinned_matches").$type<string[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  handleUnique: uniqueIndex("profiles_handle_unique").on(table.handle),
}));

// One row per Clerk user who finished the post-sign-up flow at /welcome
// (app/welcome/actions.ts finishOnboarding); no row = not onboarded yet.
// Answers are option ids from app/lib/onboardingQuestions.ts, not copy.
// Finishing requires confirming 18+, so a row also records that.
export const onboarding = pgTable("onboarding", {
  userId: text("user_id").primaryKey(),
  goals: jsonb("goals").$type<string[]>().notNull(), // ≥1 GOALS id
  experience: text("experience").notNull(), // EXPERIENCE id
  paces: jsonb("paces").$type<string[]>().notNull(), // PACES ids, may be empty
  interests: jsonb("interests").$type<string[]>().notNull(), // TopicIds, may be empty
  referral: text("referral"), // REFERRALS id, null = skipped
  timezone: text("timezone"), // IANA zone reported by the browser
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per challenge sent from a profile (app/profile/challengeActions.ts).
// Requests only for now: profiles you can open are mock traders who can't
// reply, so nothing reserves Embers or creates a `matches` row yet — that
// happens on accept, once real accounts can receive challenges. The target
// is a profile handle ("@vesper"); ranks are snapshots from send time, which
// is when the one-tier-up gate (app/lib/rank.ts canChallenge) was checked.
export const challenges = pgTable("challenges", {
  id: text("id").primaryKey(),
  challengerId: text("challenger_id").notNull(), // Clerk user id
  challengerRank: text("challenger_rank").notNull(),
  targetHandle: text("target_handle").notNull(),
  targetUserId: text("target_user_id"), // real accounts; null for mock traders
  targetRank: text("target_rank").notNull(),
  mode: text("mode").notNull(), // "pulse" | "portfolio"
  market: text("market"), // pulse only: "btc" | "eth" | "hype"
  timerSeconds: integer("timer_seconds"), // pulse only
  stake: integer("stake").notNull(), // Embers, proposed — not reserved; 0 = no stakes
  // "pending" → "canceled" (sender) | "declined" (target) → "dismissed" (sender
  // clears it) | "accepted" (target; `match_id` is the private round it opened)
  status: text("status").notNull().default("pending"),
  matchId: text("match_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // One open challenge per challenger → target, so a double-submit can't send two.
  onePending: uniqueIndex("challenges_one_pending")
    .on(table.challengerId, table.targetHandle)
    .where(sql`${table.status} = 'pending'`),
}));

// When each signed-in account last had the app open: the header heartbeat
// (app/LiveChallenges.tsx → POST /api/presence) bumps it every few seconds and
// deletes the row when the tab closes. "Online" = seen within lib/presence.ts
// ONLINE_WINDOW; challenges need both sides online. Created by db/presence.sql.
export const presence = pgTable("presence", {
  userId: text("user_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per follow. Everyone starts following no one, with no followers.
// `target` is the followed account's user id, or a mock trader's "@handle"
// (app/lib/mockProfiles.ts) — those never follow anyone back. Challenges need
// a follow both ways (app/profile/challengeActions.ts). Created by db/follows.sql.
export const follows = pgTable("follows", {
  followerId: text("follower_id").notNull(), // user id
  target: text("target").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.followerId, table.target] }),
  byTarget: index("follows_target").on(table.target),
}));
