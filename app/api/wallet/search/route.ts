import { searchTokens } from "@/lib/basePrices";

export const dynamic = "force-dynamic";

/** GET ?q= -> Base-chain token search, same as /api/tokens/search but without the Clerk gate (see docs/wallet.md). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.trim().length < 2) {
    return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const results = await searchTokens(query);
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
