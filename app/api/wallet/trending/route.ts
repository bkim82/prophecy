import { getTrendingTokens } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/** GET -> trending Base coins, same as /api/tokens/trending but without the Clerk gate (see docs/wallet.md). */
export async function GET() {
  const results = await getTrendingTokens();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
