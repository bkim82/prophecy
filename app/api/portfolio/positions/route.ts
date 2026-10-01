import { auth } from "@clerk/nextjs/server";
import { getTokenPrices } from "@/lib/basePrices";
import {
  PORTFOLIO_MAX_STAKE,
  currentSessionFor,
  isPortfolioLeverage,
  isPositionKind,
  isPositionSide,
  openPosition,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * POST { kind, tokenAddress, tokenSymbol, tokenName, side?, leverage?, amount }
 * → opens a position against the caller's active session at the live price.
 * Spot positions have no side/leverage (buy-to-open, sell-to-close via the
 * close route); leverage positions require both.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const session = await currentSessionFor(userId);
  if (!session) return Response.json({ error: "No active session" }, { status: 409 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const kind = body.kind;
  const tokenAddress = typeof body.tokenAddress === "string" ? body.tokenAddress : "";
  const tokenSymbol = typeof body.tokenSymbol === "string" ? body.tokenSymbol : "";
  const tokenName = typeof body.tokenName === "string" ? body.tokenName : "";
  const amount = Number(body.amount);

  if (!isPositionKind(kind)) return Response.json({ error: "Invalid position kind" }, { status: 400 });
  if (!tokenAddress || !tokenSymbol) return Response.json({ error: "Invalid token" }, { status: 400 });
  if (!Number.isInteger(amount) || amount <= 0 || amount > PORTFOLIO_MAX_STAKE) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  let side: "long" | "short" | null = null;
  let leverage: number | null = null;
  if (kind === "leverage") {
    if (!isPositionSide(body.side)) return Response.json({ error: "Invalid side" }, { status: 400 });
    const leverageValue = Number(body.leverage);
    if (!Number.isInteger(leverageValue) || !isPortfolioLeverage(leverageValue)) {
      return Response.json({ error: "Invalid leverage" }, { status: 400 });
    }
    side = body.side;
    leverage = leverageValue;
  }

  const [price] = await getTokenPrices([tokenAddress]);
  if (!price || price.priceUsd <= 0) return Response.json({ error: "Price unavailable" }, { status: 503 });

  const result = await openPosition({
    sessionId: session.id,
    userId,
    kind,
    tokenAddress,
    tokenSymbol,
    tokenName: tokenName || tokenSymbol,
    side,
    leverage,
    amount,
    price: price.priceUsd,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.reason === "insufficient-funds" ? "Not enough available cash" : "Session is no longer active" },
      { status: result.reason === "insufficient-funds" ? 402 : 409 },
    );
  }

  return Response.json({ position: result.position });
}
