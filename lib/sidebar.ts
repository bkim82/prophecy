import "server-only";

import { and, count, desc, eq, gt, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { matches, positions, profiles } from "@/db/schema";
import { rankForHandle, rankScore, rankTier } from "@/app/lib/rank";
import {
  PERIOD_MS,
  WINDOW_MS,
  type CallWindow,
  type LeaderboardPeriod,
  type LiveArena,
  type ProfitableCall,
  type SidebarBoards,
  type TopTrader,
} from "@/app/lib/sidebar";
import { opponentNames } from "@/lib/opponentNames";
import { accountsFor } from "@/lib/profile";
import { PULSE_STARTING_CASH } from "@/lib/pulse";

// Reads behind the feed's right rail (app/lib/sidebar.ts). Only accounts with
// a handle are ranked: house bots (lib/bots.ts) have no `profiles` row, so
// the inner joins on `profiles` leave them out. Times use the database clock.

const LEADERS = 10;
const CALLS = 3;
const ARENAS = 5;
// The boards are the same for every viewer, so one read serves every render
// on this server instance for this long.
const FRESH_MS = 15_000;

const SEATS = [1, 2] as const;
type Seat = (typeof SEATS)[number];
const seatUser = (seat: Seat) => (seat === 1 ? matches.player1UserId : matches.player2UserId);
const seatProfit = (seat: Seat) => (seat === 1 ? matches.pulseProfit1 : matches.pulseProfit2);

// When a round was played: its start, else when it was created.
const playedAt = sql`coalesce(${matches.roundStartAt}, ${matches.createdAt})`;
// In the last `ms` (no limit for null).
const within = (at: SQL | PgColumn, ms: number | null) => (ms === null ? undefined : sql`${at} > now() - make_interval(secs => ${ms / 1000})`);

/** One seat's settled rounds per account: played, won and net Embers (±wager; ties 0). */
function seatRecords(seat: Seat, ms: number | null) {
  const mine = String(seat);
  const theirs = seat === 1 ? "2" : "1";
  return getDb()
    .select({
      handle: profiles.handle,
      rounds: count(),
      won: sql<number>`(count(*) filter (where ${matches.winner} = ${mine}))::int`,
      net: sql<number>`coalesce(sum(case when ${matches.winner} = ${mine} then ${matches.wager} when ${matches.winner} = ${theirs} then -${matches.wager} else 0 end), 0)::int`,
    })
    .from(matches)
    .innerJoin(profiles, eq(profiles.userId, seatUser(seat)))
    .where(and(eq(matches.status, "settled"), isNotNull(profiles.handle), within(playedAt, ms)))
    .groupBy(profiles.handle);
}

/** Top Oracles: most net Embers from settled Arena rounds, then win rate, then rounds played. */
async function topTraders(ms: number | null): Promise<TopTrader[]> {
  const totals = new Map<string, { rounds: number; won: number; net: number }>();
  for (const row of (await Promise.all(SEATS.map((seat) => seatRecords(seat, ms)))).flat()) {
    if (!row.handle) continue;
    const total = totals.get(row.handle) ?? { rounds: 0, won: 0, net: 0 };
    totals.set(row.handle, { rounds: total.rounds + row.rounds, won: total.won + row.won, net: total.net + row.net });
  }
  return [...totals]
    .map(([handle, total]) => ({ handle, ...total, winRate: total.won / total.rounds }))
    .sort((a, b) => b.net - a.net || b.winRate - a.winRate || b.rounds - a.rounds || a.handle.localeCompare(b.handle))
    .slice(0, LEADERS)
    .map(({ handle, winRate }) => ({ handle: `@${handle}`, tier: rankForHandle(handle), winRate }));
}

/** Closed 24h Portfolio positions that made money, best return on committed cash first. */
async function portfolioCalls(ms: number): Promise<ProfitableCall[]> {
  const roi = sql<number>`${positions.realizedPnl}::float8 / ${positions.committedCash} * 100`.mapWith(Number);
  const rows = await getDb()
    .select({ id: positions.id, handle: profiles.handle, symbol: positions.tokenSymbol, kind: positions.kind, side: positions.side, leverage: positions.leverage, roi })
    .from(positions)
    .innerJoin(profiles, eq(profiles.userId, positions.userId))
    .where(and(eq(positions.status, "closed"), isNotNull(profiles.handle), gt(positions.committedCash, 0), gt(positions.realizedPnl, 0), within(positions.closedAt, ms)))
    .orderBy(desc(roi))
    .limit(CALLS);
  return rows.flatMap((row): ProfitableCall[] =>
    row.handle
      ? [
          {
            id: `portfolio:${row.id}`,
            source: "portfolio",
            handle: `@${row.handle}`,
            symbol: row.symbol,
            position: row.kind === "spot" ? "spot" : row.side === "short" ? "short" : "long",
            leverage: row.kind === "spot" ? null : row.leverage,
            roiPct: row.roi,
          },
        ]
      : [],
  );
}

/** One seat's settled Arena rounds that made money, best round P&L ÷ starting cash first. */
async function arenaCalls(seat: Seat, ms: number): Promise<ProfitableCall[]> {
  const profit = seatProfit(seat);
  const rows = await getDb()
    .select({ id: matches.id, handle: profiles.handle, market: matches.market, profit })
    .from(matches)
    .innerJoin(profiles, eq(profiles.userId, seatUser(seat)))
    .where(and(eq(matches.status, "settled"), isNotNull(profiles.handle), gt(profit, 0), within(playedAt, ms)))
    .orderBy(desc(profit))
    .limit(CALLS);
  return rows.flatMap((row): ProfitableCall[] =>
    row.handle && row.profit !== null
      ? [
          {
            // Both seats can finish green, so the seat keeps the key unique.
            id: `arena:${row.id}:${seat}`,
            source: "arena",
            handle: `@${row.handle}`,
            symbol: row.market.toUpperCase(),
            position: "round",
            leverage: null,
            roiPct: (row.profit / PULSE_STARTING_CASH) * 100,
          },
        ]
      : [],
  );
}

async function profitableCalls(ms: number): Promise<ProfitableCall[]> {
  const lists = await Promise.all([portfolioCalls(ms), ...SEATS.map((seat) => arenaCalls(seat, ms))]);
  return lists
    .flat()
    .sort((a, b) => b.roiPct - a.roiPct)
    .slice(0, CALLS);
}

type LiveRound = Omit<LiveArena, "secondsLeft"> & { endsAt: number };

/** Public Pulse rounds in progress (not challenge rounds), ending soonest first. `endsAt` is on this server's clock. */
async function liveRounds(): Promise<LiveRound[]> {
  const ends = sql`${matches.roundStartAt} + make_interval(secs => ${matches.timerSeconds})`;
  const rows = await getDb()
    .select({
      id: matches.id,
      player1: matches.player1UserId,
      player2: matches.player2UserId,
      msLeft: sql<number>`(extract(epoch from (${ends} - now())) * 1000)::int`,
    })
    .from(matches)
    .where(and(eq(matches.status, "countdown"), isNull(matches.invitedUserId), isNotNull(matches.roundStartAt), sql`${ends} > now()`))
    .orderBy(ends)
    .limit(ARENAS);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((row) => [row.player1, row.player2]).filter((id) => id !== null))];
  const [names, accounts] = await Promise.all([opponentNames(ids), accountsFor(ids)]);
  const handles = new Map(accounts.map((account) => [account.userId, account.handle]));
  const name = (id: string | null) => (id && names.get(id)) || "Player";
  const now = Date.now();
  return rows.map((row) => {
    // Players without a handle (house bots included) rank as the stub's VIEWER_RANK.
    const [first, second] = [row.player1, row.player2].map((id) => rankForHandle(id ? handles.get(id) : null));
    const top = rankScore(second) > rankScore(first) ? second : first;
    return { id: row.id, players: `${name(row.player1)} vs ${name(row.player2)}`, endsAt: now + row.msLeft, tier: rankTier(top) ?? "bronze" };
  });
}

type Boards = Omit<SidebarBoards, "arenas"> & { rounds: LiveRound[] };

// A failed read leaves its board empty (the panel hides) rather than failing the page.
const none =
  <T,>(board: string) =>
  (error: unknown): T[] => {
    console.error(`${board} unavailable`, error);
    return [];
  };

async function readBoards(): Promise<Boards> {
  const periods = Object.keys(PERIOD_MS) as LeaderboardPeriod[];
  const spans = Object.keys(WINDOW_MS) as CallWindow[];
  const [leaders, calls, rounds] = await Promise.all([
    Promise.all(periods.map((period) => topTraders(PERIOD_MS[period]).catch(none<TopTrader>("Leaderboard")))),
    Promise.all(spans.map((span) => profitableCalls(WINDOW_MS[span]).catch(none<ProfitableCall>("Profitable calls")))),
    liveRounds().catch(none<LiveRound>("Live rounds")),
  ]);
  return {
    leaders: Object.fromEntries(periods.map((period, i) => [period, leaders[i]])) as Record<LeaderboardPeriod, TopTrader[]>,
    calls: Object.fromEntries(spans.map((span, i) => [span, calls[i]])) as Record<CallWindow, ProfitableCall[]>,
    rounds,
  };
}

let cached: { at: number; boards: Promise<Boards> } | null = null;

/** Everything the rail shows, at most FRESH_MS old; live rounds' time left is as of now, and finished ones drop out. */
export async function sidebarBoards(): Promise<SidebarBoards> {
  if (!cached || Date.now() - cached.at > FRESH_MS) cached = { at: Date.now(), boards: readBoards() };
  const { rounds, ...boards } = await cached.boards;
  const now = Date.now();
  const arenas = rounds.flatMap(({ endsAt, ...round }) => (endsAt > now ? [{ ...round, secondsLeft: Math.ceil((endsAt - now) / 1000) }] : []));
  return { ...boards, arenas };
}
