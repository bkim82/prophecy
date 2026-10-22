import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, portfolioSessions, positions } from "@/db/schema";
import type { BestTrade, ProfileRecords } from "@/app/lib/mockAchievements";
import type { CopyEarnings, TradingStyle } from "@/app/lib/profileTraits";
import { settledFor } from "@/lib/match";
import { PULSE_STARTING_CASH } from "@/lib/pulse";

// A real account's achievements and trading style, from what it actually
// played: settled Arena (Pulse) rounds plus closed 24h Portfolio positions and
// settled sessions. Pulse rounds keep only their P&L (lib/match.ts settleIfDue
// clears positions), so side and leverage come from Portfolio positions alone.

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
// Fewer rounds + positions than this is too little to call a style.
const MIN_STYLE_SAMPLE = 5;
const HOUR_MS = 3_600_000;

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

// Copy trading isn't live, so nobody has copied anyone yet.
export const NO_COPY_EARNINGS: CopyEarnings = { copiers: 0, copies: 0, earned: 0 };

export type Activity = { records: ProfileRecords | null; style: TradingStyle | null };

/** Null records when the account hasn't finished a round, trade or session; null style below MIN_STYLE_SAMPLE. */
export async function activityFor(userId: string, rank: string): Promise<Activity> {
  const db = getDb();
  const [rounds, closed, sessions] = await Promise.all([
    db
      .select({
        player1UserId: matches.player1UserId,
        winner: matches.winner,
        profit1: matches.pulseProfit1,
        profit2: matches.pulseProfit2,
        market: matches.market,
        timerSeconds: matches.timerSeconds,
        createdAt: matches.createdAt,
      })
      .from(matches)
      .where(settledFor(userId))
      .orderBy(asc(matches.createdAt)),
    db
      .select({
        side: positions.side,
        leverage: positions.leverage,
        committedCash: positions.committedCash,
        realizedPnl: positions.realizedPnl,
        tokenSymbol: positions.tokenSymbol,
        openedAt: positions.openedAt,
        closedAt: positions.closedAt,
      })
      .from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, "closed"))),
    db
      .select({ startingBalance: portfolioSessions.startingBalance, realizedPnl: portfolioSessions.realizedPnl })
      .from(portfolioSessions)
      .where(and(eq(portfolioSessions.userId, userId), eq(portfolioSessions.status, "settled"))),
  ]);
  if (rounds.length + closed.length + sessions.length === 0) return { records: null, style: null };

  const results = rounds.map((round) => {
    const role = round.player1UserId === userId ? "1" : "2";
    return { ...round, won: round.winner === role, profit: (role === "1" ? round.profit1 : round.profit2) ?? 0 };
  });
  let streak = 0;
  let longestStreak = 0;
  for (const result of results) {
    streak = result.won ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }
  const won = results.filter((result) => result.won).length;

  // Biggest ROI across whole Pulse rounds (P&L on the round's starting cash) and single Portfolio positions.
  const trades: BestTrade[] = [
    ...results.map((result) => ({ market: result.market, roi: (result.profit / PULSE_STARTING_CASH) * 100, date: monthFormat.format(result.createdAt) })),
    ...closed
      .filter((position) => position.committedCash > 0)
      .map((position) => ({
        market: position.tokenSymbol,
        side: position.side === "short" ? ("SHORT" as const) : ("LONG" as const),
        leverage: position.leverage ?? 1,
        roi: ((position.realizedPnl ?? 0) / position.committedCash) * 100,
        date: monthFormat.format(position.closedAt ?? position.openedAt),
      })),
  ];
  const bestTrade = trades.reduce<BestTrade | null>((best, trade) => (!best || trade.roi > best.roi ? trade : best), null);
  const sessionReturns = sessions.filter((session) => session.startingBalance > 0).map((session) => (session.realizedPnl / session.startingBalance) * 100);

  const sample = results.length + closed.length;
  const style: TradingStyle | null =
    sample < MIN_STYLE_SAMPLE
      ? null
      : {
          pulseShare: results.length / sample,
          avgHoldHours: mean([
            ...results.map((result) => result.timerSeconds / 3600),
            ...closed.map((position) => ((position.closedAt ?? position.openedAt).getTime() - position.openedAt.getTime()) / HOUR_MS),
          ]),
          fadeShare: closed.length ? closed.filter((position) => position.side === "short").length / closed.length : 0,
          avgLeverage: closed.length ? mean(closed.map((position) => position.leverage ?? 1)) : 0,
        };

  return {
    records: {
      peakElo: null,
      peakRank: rank,
      bestTrade,
      longestStreak,
      winRate: results.length ? won / results.length : null,
      calls: results.length,
      unit: "rounds",
      bestSession: sessionReturns.length ? Math.max(...sessionReturns) : null,
      duelsWon: won,
    },
    style,
  };
}
