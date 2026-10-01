import { auth } from "@clerk/nextjs/server";
import { getTrendingTokens } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/** GET → trending Base coins for the coin picker's pre-search row, thin wrapper over lib/tokenHistory.ts. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const results = await getTrendingTokens();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
