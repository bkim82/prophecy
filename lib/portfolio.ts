import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { portfolioPayouts, portfolioSessions, positions } from "@/db/schema";
import { refundBalance, reserveBalance } from "@/lib/balance";
import { getTokenPrices } from "@/lib/basePrices";
import {
  availableCash,
  positionPnl,
  sessionEndAt,
  spotQtyForAmount,
  type PositionKind,
  type PositionSide,
} from "@/lib/portfolioRules";

export * from "@/lib/portfolioRules";

export type SessionRow = typeof portfolioSessions.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;

/**
 * Starts a 24h session: reserves the stake, then a single guarded INSERT
 * relying on `portfolio_sessions_one_active_per_user` (db/schema.ts) to
 * enforce "one active session per user" without a read-then-insert. A
 * conflict refunds the reservation, the same order POST /api/reading used to
 * reserve-then-insert-then-refund-on-conflict.
 */
export async function startSession(userId: string, stake: number): Promise<SessionRow | null> {
  const reserved = await reserveBalance(userId, stake);
  if (!reserved) return null;

  try {
    const now = Date.now();
    const [created] = await getDb()
      .insert(portfolioSessions)
      .values({
        id: crypto.randomUUID(),
        userId,
        startingBalance: stake,
        endAt: new Date(sessionEndAt(now)),
        status: "active",
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      await refundBalance(userId, stake);
      return null;
    }
    return created;
  } catch (error) {
    await refundBalance(userId, stake);
    throw error;
  }
}

export async function currentSessionFor(userId: string): Promise<SessionRow | null> {
  const [row] = await getDb()
    .select()
    .from(portfolioSessions)
    .where(and(eq(portfolioSessions.userId, userId), eq(portfolioSessions.status, "active")));
  return row ?? null;
}

export async function openPositionsFor(sessionId: string): Promise<PositionRow[]> {
  return getDb()
    .select()
    .from(positions)
    .where(and(eq(positions.sessionId, sessionId), eq(positions.status, "open")));
}

export async function sessionHistoryFor(userId: string, limit = 10): Promise<SessionRow[]> {
  return getDb()
    .select()
    .from(portfolioSessions)
    .where(and(eq(portfolioSessions.userId, userId), eq(portfolioSessions.status, "settled")))
    .orderBy(desc(portfolioSessions.settledAt))
    .limit(limit);
}

export async function closedPositionsFor(sessionId: string, limit = 50): Promise<PositionRow[]> {
  return getDb()
    .select()
    .from(positions)
    .where(and(eq(positions.sessionId, sessionId), eq(positions.status, "closed")))
    .orderBy(desc(positions.closedAt))
    .limit(limit);
}

export type OpenPositionInput = {
  sessionId: string;
  userId: string;
  kind: PositionKind;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  side: PositionSide | null; // leverage only
  leverage: number | null; // leverage only
  amount: number; // embers committed: spot cost basis or leverage margin
  price: number;
};

export type OpenPositionResult =
  | { ok: true; position: PositionRow }
  | { ok: false; reason: "session-not-active" | "insufficient-funds" };

/**
 * Reserves `amount` against the session's committed cash with a single
 * guarded UPDATE (buying power + session-active check in the WHERE clause,
 * no read-then-write), then inserts the position row. On insert failure the
 * reservation is compensated, mirroring lib/balance.ts reserveBalance's
 * pair-with-refundBalance idiom.
 */
export async function openPosition(input: OpenPositionInput): Promise<OpenPositionResult> {
  const db = getDb();
  const [reserved] = await db
    .update(portfolioSessions)
    .set({ committedCash: sql`${portfolioSessions.committedCash} + ${input.amount}` })
    .where(
      and(
        eq(portfolioSessions.id, input.sessionId),
        eq(portfolioSessions.userId, input.userId),
        eq(portfolioSessions.status, "active"),
        sql`${portfolioSessions.endAt} > now()`,
        sql`(${portfolioSessions.startingBalance} - ${portfolioSessions.committedCash} + ${portfolioSessions.realizedPnl}) >= ${input.amount}`,
      ),
    )
    .returning();

  if (!reserved) {
    const current = await currentSessionFor(input.userId);
    if (!current || current.id !== input.sessionId) return { ok: false, reason: "session-not-active" };
    return { ok: false, reason: "insufficient-funds" };
  }

  try {
    const qty = input.kind === "spot" ? spotQtyForAmount(input.amount, input.price) : null;
    const [created] = await db
      .insert(positions)
      .values({
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        userId: input.userId,
        kind: input.kind,
        tokenAddress: input.tokenAddress.toLowerCase(),
        tokenSymbol: input.tokenSymbol,
        tokenName: input.tokenName,
        side: input.kind === "leverage" ? input.side : null,
        leverage: input.kind === "leverage" ? input.leverage : null,
        qty,
        entryPrice: input.price,
        committedCash: input.amount,
        status: "open",
      })
      .returning();

    if (!created) throw new Error("Position insert returned no row");
    return { ok: true, position: created };
  } catch (error) {
    await db
      .update(portfolioSessions)
      .set({ committedCash: sql`${portfolioSessions.committedCash} - ${input.amount}` })
      .where(eq(portfolioSessions.id, input.sessionId));
    throw error;
  }
}

/**
 * Closes one position at `price`. P&L is computed from the position's
 * immutable fields (entryPrice/qty/committedCash/leverage/side never change
 * after open), so reading them outside the guard is safe — only the guarded
 * UPDATE below can actually flip `status`, making concurrent close attempts
 * (double-click, two polls) land exactly once. The CTE folds the position
 * close and the session's committed-cash/realized-pnl update into one
 * statement, atomic under Postgres even without an explicit transaction
 * (`neon-http` has none — see lib/balance.ts creditPayout for the same shape).
 */
export async function closePosition(
  positionId: string,
  userId: string,
  price: number,
  closeReason: "manual" | "session_end" = "manual",
): Promise<{ position: PositionRow; session: SessionRow } | null> {
  const [row] = await getDb()
    .select()
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.userId, userId)));
  if (!row || row.status !== "open") return null;

  const pnl = positionPnl(
    {
      kind: row.kind as PositionKind,
      qty: row.qty,
      entryPrice: row.entryPrice,
      committedCash: row.committedCash,
      leverage: row.leverage,
      side: row.side as PositionSide | null,
    },
    price,
  );

  const closedAt = new Date();
  const rows = await getDb().execute<SessionRow>(sql`
    WITH closed AS (
      UPDATE ${positions}
      SET status = 'closed', exit_price = ${price}, realized_pnl = ${pnl},
          close_reason = ${closeReason}, closed_at = ${closedAt.toISOString()}::timestamptz
      WHERE id = ${positionId} AND status = 'open'
      RETURNING session_id, committed_cash, realized_pnl
    )
    UPDATE ${portfolioSessions}
    SET committed_cash = ${portfolioSessions.committedCash} - closed.committed_cash,
        realized_pnl = ${portfolioSessions.realizedPnl} + closed.realized_pnl
    FROM closed
    WHERE ${portfolioSessions.id} = closed.session_id
    RETURNING ${portfolioSessions}.*
  `);

  const session = rows.rows[0];
  if (!session) return null; // already closed by a concurrent request
  return {
    position: { ...row, status: "closed", exitPrice: price, realizedPnl: pnl, closeReason, closedAt },
    session,
  };
}

/** Idempotent payout ledger, same pattern as lib/balance.ts creditPayout. */
async function creditPortfolioPayout(sessionId: string, userId: string, amount: number) {
  await getDb().execute(sql`
    WITH credited AS (
      INSERT INTO ${portfolioPayouts} (id, session_id, user_id, amount)
      VALUES (${sessionId}, ${sessionId}, ${userId}, ${amount})
      ON CONFLICT (id) DO NOTHING
      RETURNING user_id, amount
    )
    UPDATE users
    SET balance = users.balance + credited.amount
    FROM credited
    WHERE users.id = credited.user_id
  `);
}

/**
 * Force-closes every open position of this user's session once `endAt` has
 * passed, then finalizes and pays out the session. Lazy and idempotent, the
 * same shape as the retired settleReadingsIfDue/lib/match.ts settleIfDue: any
 * poll may call it, and a price-source outage just leaves positions open for
 * the next poll to retry.
 */
export async function settlePortfolioIfDue(userId: string): Promise<void> {
  const session = await currentSessionFor(userId);
  if (!session || session.endAt.getTime() > Date.now()) return;

  const open = await openPositionsFor(session.id);
  if (open.length > 0) {
    const prices = await getTokenPrices(open.map((position) => position.tokenAddress));
    const priceByAddress = new Map(prices.map((price) => [price.address, price]));
    for (const position of open) {
      const price = priceByAddress.get(position.tokenAddress);
      if (!price || price.priceUsd <= 0) continue; // retry next poll
      await closePosition(position.id, userId, price.priceUsd, "session_end");
    }
  }

  const stillOpen = await openPositionsFor(session.id);
  if (stillOpen.length > 0) return;

  const [settled] = await getDb()
    .update(portfolioSessions)
    .set({ status: "settled", settledAt: new Date() })
    .where(and(eq(portfolioSessions.id, session.id), eq(portfolioSessions.status, "active")))
    .returning();
  if (!settled) return;

  const payout = settled.startingBalance + settled.realizedPnl;
  await creditPortfolioPayout(settled.id, userId, Math.max(0, payout));
}

export type PositionMark = { markPrice: number; unrealizedPnl: number; stale: boolean };

export type PortfolioView = {
  session: {
    id: string;
    startingBalance: number;
    committedCash: number;
    realizedPnl: number;
    availableCash: number;
    equity: number;
    status: "active" | "settled";
    startAt: number;
    endAt: number;
  };
  positions: (PositionRow & { markPrice: number; unrealizedPnl: number; priceStale: boolean })[];
};

/** Attaches live mark prices/unrealized P&L to every open position, plus session-level equity. */
export async function portfolioView(session: SessionRow, open: PositionRow[]): Promise<PortfolioView> {
  const prices = await getTokenPrices(open.map((position) => position.tokenAddress));
  const priceByAddress = new Map(prices.map((price) => [price.address, price]));

  const viewedPositions = open.map((position) => {
    const mark = priceByAddress.get(position.tokenAddress);
    const markPrice = mark?.priceUsd ?? position.entryPrice;
    const unrealizedPnl = positionPnl(
      {
        kind: position.kind as PositionKind,
        qty: position.qty,
        entryPrice: position.entryPrice,
        committedCash: position.committedCash,
        leverage: position.leverage,
        side: position.side as PositionSide | null,
      },
      markPrice,
    );
    return { ...position, markPrice, unrealizedPnl, priceStale: mark?.stale ?? true };
  });

  const unrealizedTotal = viewedPositions.reduce((total, position) => total + position.unrealizedPnl, 0);
  const cash = availableCash(session.startingBalance, session.committedCash, session.realizedPnl);

  return {
    session: {
      id: session.id,
      startingBalance: session.startingBalance,
      committedCash: session.committedCash,
      realizedPnl: session.realizedPnl,
      availableCash: cash,
      equity: cash + session.committedCash + unrealizedTotal,
      status: session.status as "active" | "settled",
      startAt: session.startAt.getTime(),
      endAt: session.endAt.getTime(),
    },
    positions: viewedPositions,
  };
}
