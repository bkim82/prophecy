import { getTrendingTokens } from "@/lib/tokenHistory";
import { allowWalletRead, walletReadLimited } from "../readLimit";

export const dynamic = "force-dynamic";

/** GET -> trending Base coins, same as /api/tokens/trending but without the Clerk gate (see docs/wallet.md). */
export async function GET(request: Request) {
  if (!await allowWalletRead(request, "trending", 30)) return walletReadLimited();
  const results = await getTrendingTokens();
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
