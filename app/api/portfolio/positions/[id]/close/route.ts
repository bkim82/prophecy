import { auth } from "@clerk/nextjs/server";
import { getTokenPrices } from "@/lib/basePrices";
import { closePosition } from "@/lib/portfolio";
import { getDb } from "@/db";
import { positions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** POST → closes one open position at the live price. Idempotent: closing an already-closed position is a no-op 409. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const { id } = await ctx.params;
  const [row] = await getDb().select().from(positions).where(eq(positions.id, id));
  if (!row || row.userId !== userId) return Response.json({ error: "Position not found" }, { status: 404 });
  if (row.status !== "open") return Response.json({ error: "Position is already closed" }, { status: 409 });

  const [price] = await getTokenPrices([row.tokenAddress]);
  if (!price || price.priceUsd <= 0) return Response.json({ error: "Price unavailable" }, { status: 503 });

  const result = await closePosition(id, userId, price.priceUsd, "manual");
  if (!result) return Response.json({ error: "Position is already closed" }, { status: 409 });

  return Response.json({ position: result.position });
}
