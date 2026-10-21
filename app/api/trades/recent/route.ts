import { recentTradesFor } from "@/lib/trades";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * GET → { trades: TradeReceipt[] } — the signed-in user's newest trades (24h
 * Portfolio positions + settled Arena rounds) for the composer's trade
 * picker. Viewer-scoped through getViewer(); never takes a user id.
 */
export async function GET() {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Sign in to attach your trades" }, { status: 401 });

  return Response.json({ trades: await recentTradesFor(userId) }, { headers: { "Cache-Control": "no-store" } });
}
