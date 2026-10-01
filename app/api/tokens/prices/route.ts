import { auth } from "@clerk/nextjs/server";
import { getTokenPrices, getTokenSummaries } from "@/lib/basePrices";

export const dynamic = "force-dynamic";

/**
 * POST { addresses } → live mark prices for a set of Base token addresses,
 * plus `tokens` (price + logo/24h change/market cap) for the trade ticket's
 * live selected-coin header.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to play" }, { status: 401 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const rawAddresses: unknown[] = Array.isArray(body.addresses) ? body.addresses : [];
  const addresses = rawAddresses.filter((address): address is string => typeof address === "string");
  if (addresses.length === 0 || addresses.length > 30) {
    return Response.json({ error: "Invalid addresses" }, { status: 400 });
  }

  const prices = await getTokenPrices(addresses);
  const tokens = await getTokenSummaries(addresses); // same cache — no extra fetch
  return Response.json({ prices, tokens }, { headers: { "Cache-Control": "no-store" } });
}
