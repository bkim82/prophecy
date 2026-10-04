import { getNewTokens } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/** GET -> newly created Base pools with real liquidity, same as /api/tokens/new but without the Clerk gate (see docs/wallet.md). */
export async function GET() {
  const results = await getNewTokens();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
