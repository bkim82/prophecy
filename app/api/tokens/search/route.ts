import { searchTokens } from "@/lib/basePrices";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** GET ?q= → Base-chain token search (name/symbol), thin wrapper over lib/basePrices.ts. */
export async function GET(request: Request) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.trim().length < 2) {
    return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const results = await searchTokens(query);
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
