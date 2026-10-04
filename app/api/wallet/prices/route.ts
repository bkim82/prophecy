import { getTokenPrices, getTokenSummaries } from "@/lib/basePrices";

export const dynamic = "force-dynamic";

/** POST { addresses } -> live prices + token summaries, same as /api/tokens/prices but without the Clerk gate (see docs/wallet.md). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const rawAddresses: unknown[] = Array.isArray(body.addresses) ? body.addresses : [];
  const addresses = rawAddresses.filter((address): address is string => typeof address === "string");
  if (addresses.length === 0 || addresses.length > 30) {
    return Response.json({ error: "Invalid addresses" }, { status: 400 });
  }

  const prices = await getTokenPrices(addresses);
  const tokens = await getTokenSummaries(addresses);
  return Response.json({ prices, tokens }, { headers: { "Cache-Control": "no-store" } });
}
