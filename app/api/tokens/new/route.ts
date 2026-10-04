import { auth } from "@clerk/nextjs/server";
import { getNewTokens } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/** GET → newly created Base pools with real liquidity, for the explorer's "New" filter (lib/tokenHistory.ts getNewTokens). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const results = await getNewTokens();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
