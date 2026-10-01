import { auth } from "@clerk/nextjs/server";
import { getTokenMetas } from "@/lib/basePrices";
import {
  PORTFOLIO_MAX_STAKE,
  closedPositionsFor,
  currentSessionFor,
  openPositionsFor,
  portfolioView,
  sessionHistoryFor,
  settlePortfolioIfDue,
  startSession,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * GET → the caller's current 24h portfolio session (if any) with live mark
 * prices/unrealized P&L per open position, this session's closed positions,
 * and recent settled-session history. Every position row also carries the
 * token's logo/24h change from lib/basePrices.ts's meta cache (null when the
 * token has no logo). Settles any past-due session first,
 * the same lazy pattern as GET /api/match/[id] and the retired /api/reading.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  await settlePortfolioIfDue(userId);

  const session = await currentSessionFor(userId);
  const [open, closed, history] = await Promise.all([
    session ? openPositionsFor(session.id) : Promise.resolve([]),
    session ? closedPositionsFor(session.id) : Promise.resolve([]),
    sessionHistoryFor(userId),
  ]);
  const view = session ? await portfolioView(session, open) : null;
  const metas = await getTokenMetas([...open, ...closed].map((position) => position.tokenAddress));
  const withMeta = <T extends { tokenAddress: string }>(position: T) => {
    const meta = metas.get(position.tokenAddress);
    return { ...position, imageUrl: meta?.imageUrl ?? null, change24h: meta?.change24h ?? null };
  };

  return Response.json(
    {
      serverNow: Date.now(),
      session: view?.session ?? null,
      positions: (view?.positions ?? []).map(withMeta),
      closedPositions: closed.map(withMeta),
      history,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST { stake } → starts a new 24h session. 409 if one is already active. */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const stake = Number(body.stake);
  if (!Number.isInteger(stake) || stake <= 0 || stake > PORTFOLIO_MAX_STAKE) {
    return Response.json({ error: "Invalid stake" }, { status: 400 });
  }

  const session = await startSession(userId, stake);
  if (!session) {
    return Response.json(
      { error: "You already have an active session, or your balance is too low" },
      { status: 409 },
    );
  }

  return Response.json({
    session: {
      id: session.id,
      startingBalance: session.startingBalance,
      committedCash: session.committedCash,
      realizedPnl: session.realizedPnl,
      availableCash: session.startingBalance,
      equity: session.startingBalance,
      status: session.status,
      startAt: session.startAt.getTime(),
      endAt: session.endAt.getTime(),
    },
  });
}
