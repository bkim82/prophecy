import "server-only";

import { and, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, presence, profiles } from "@/db/schema";
import type { ArenaLobby, FeaturedMatch, FeaturedSeat, LobbyWin, TopCaller } from "@/app/lib/arenaLobby";
import { opponentNames } from "@/lib/opponentNames";
import { ONLINE_WINDOW } from "@/lib/presence";
import { pulsePositionsPnl, type PulsePosition } from "@/lib/pulse";
import { rankedRecords } from "@/lib/sidebar";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";

// Reads behind the Arena page's lobby extras (app/lib/arenaLobby.ts). Public
// rounds only — challenge rounds (`invited_user_id`) stay private — and, like
// the feed rail (lib/sidebar.ts), wins and leaders list accounts with a handle,
// never house bots. The featured match names its seats the way the rail's
// "Live in the Arena" does (lib/opponentNames.ts, bots by persona).

const WINS = 8;
const LEADERS = 5;
const DAY_MS = 24 * 3_600_000;
// Same for every viewer, so one read serves every poll on this instance this long.
const FRESH_MS = 5_000;

const roundEnd = sql`${matches.roundStartAt} + make_interval(secs => ${matches.timerSeconds})`;

/** Newest settled public rounds with a winner who has a handle, last 24h. */
async function recentWins(): Promise<LobbyWin[]> {
  const winnerUser = sql`case when ${matches.winner} = '1' then ${matches.player1UserId} else ${matches.player2UserId} end`;
  const rows = await getDb()
    .select({
      id: matches.id,
      handle: profiles.handle,
      wager: matches.wager,
      market: matches.market,
      timerSeconds: matches.timerSeconds,
      endedAt: sql<number>`(extract(epoch from ${roundEnd}) * 1000)::float8`.mapWith(Number),
    })
    .from(matches)
    .innerJoin(profiles, eq(profiles.userId, winnerUser))
    .where(
      and(
        eq(matches.status, "settled"),
        inArray(matches.winner, ["1", "2"]),
        isNull(matches.invitedUserId),
        isNotNull(matches.roundStartAt),
        isNotNull(profiles.handle),
        sql`${roundEnd} > now() - make_interval(secs => ${DAY_MS / 1000})`,
      ),
    )
    .orderBy(desc(roundEnd))
    .limit(WINS);
  return rows.flatMap((row) =>
    row.handle
      ? [{ id: row.id, handle: `@${row.handle}`, amount: row.wager * 2, market: row.market, timerSeconds: row.timerSeconds, endedAt: row.endedAt }]
      : [],
  );
}

/** Net direction of what's open: the side with more notional (stake × leverage). */
function netSide(positions: PulsePosition[]): FeaturedSeat["side"] {
  const net = positions.reduce((sum, p) => sum + (p.side === "long" ? 1 : -1) * p.stake * p.leverage, 0);
  return net > 0 ? "long" : net < 0 ? "short" : null;
}

/**
 * One public round in progress: the selected market's if there is one, else
 * any, with the most time left so it doesn't vanish on the next poll.
 */
async function featuredMatch(market: string | null): Promise<FeaturedMatch | null> {
  const [row] = await getDb()
    .select({
      id: matches.id,
      market: matches.market,
      timerSeconds: matches.timerSeconds,
      player1: matches.player1UserId,
      player2: matches.player2UserId,
      positions1: matches.pulsePositions1,
      positions2: matches.pulsePositions2,
      realized1: matches.pulseRealizedPnl1,
      realized2: matches.pulseRealizedPnl2,
      msLeft: sql<number>`(extract(epoch from (${roundEnd} - now())) * 1000)::int`,
    })
    .from(matches)
    .where(and(eq(matches.status, "countdown"), isNull(matches.invitedUserId), isNotNull(matches.roundStartAt), sql`${roundEnd} > now()`))
    .orderBy(sql`(${matches.market} = ${market ?? ""}) desc`, desc(roundEnd))
    .limit(1);
  if (!row) return null;

  const product = productForMarket(row.market);
  const [names, spot] = await Promise.all([
    opponentNames([row.player1, row.player2]),
    product ? getSpotPrice(product) : Promise.resolve(null),
  ]);
  const seat = (userId: string | null, positions: PulsePosition[] | null, realized: number | null): FeaturedSeat => {
    const open = positions ?? [];
    return {
      name: (userId && names.get(userId)) || "Player",
      side: netSide(open),
      pnl: spot ? (realized ?? 0) + pulsePositionsPnl(open, spot.price) : null,
    };
  };
  return {
    id: row.id,
    market: row.market,
    timerSeconds: row.timerSeconds,
    msLeft: row.msLeft,
    seats: [seat(row.player1, row.positions1, row.realized1), seat(row.player2, row.positions2, row.realized2)],
  };
}

async function topCallers(): Promise<TopCaller[]> {
  return (await rankedRecords(DAY_MS, LEADERS)).map(({ handle, won, lost, net }) => ({ handle: `@${handle}`, won, lost, net }));
}

async function playersOnline(): Promise<number | null> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(presence)
    .where(gt(presence.lastSeenAt, sql`now() - ${ONLINE_WINDOW}`));
  return row?.n ?? 0;
}

// A failed read leaves its piece empty (the page hides it) rather than failing the poll.
const fallback =
  <T,>(what: string, value: T) =>
  (error: unknown): T => {
    console.error(`${what} unavailable`, error);
    return value;
  };

type Shared = Omit<ArenaLobby, "featured" | "serverNow">;
let cached: { at: number; shared: Promise<Shared> } | null = null;
const featuredCache = new Map<string, { at: number; featured: Promise<FeaturedMatch | null> }>();

/** Everything the lobby shows, at most FRESH_MS old. The featured match is cached per selected market. */
export async function arenaLobby(market: string | null): Promise<ArenaLobby> {
  const now = Date.now();
  if (!cached || now - cached.at > FRESH_MS) {
    cached = {
      at: now,
      shared: Promise.all([
        recentWins().catch(fallback<LobbyWin[]>("Recent wins", [])),
        topCallers().catch(fallback<TopCaller[]>("Top callers", [])),
        playersOnline().catch(fallback<number | null>("Players online", null)),
      ]).then(([wins, leaders, online]) => ({ wins, leaders, playersOnline: online })),
    };
  }
  const key = market ?? "";
  let entry = featuredCache.get(key);
  if (!entry || now - entry.at > FRESH_MS) {
    entry = { at: now, featured: featuredMatch(market).catch(fallback<FeaturedMatch | null>("Featured match", null)) };
    featuredCache.set(key, entry);
  }
  const [shared, featured] = await Promise.all([cached.shared, entry.featured]);
  // msLeft was read up to FRESH_MS ago; age it so every poll counts down from now.
  const aged = featured ? { ...featured, msLeft: featured.msLeft - (Date.now() - entry.at) } : null;
  return { ...shared, featured: aged && aged.msLeft > 0 ? aged : null, serverNow: Date.now() };
}
