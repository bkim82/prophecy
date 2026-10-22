import { searchTokens } from "@/lib/basePrices";
import { allowWalletRead, walletReadLimited } from "../readLimit";

export const dynamic = "force-dynamic";

/** GET ?q= -> Base-chain token search, same as /api/tokens/search but without the Clerk gate (see docs/wallet.md). */
export async function GET(request: Request) {
  if (!await allowWalletRead(request, "search", 60)) return walletReadLimited();
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 64);
  if (query.trim().length < 2) {
    return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const results = await searchTokens(query);
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
