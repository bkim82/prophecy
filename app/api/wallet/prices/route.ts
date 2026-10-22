import { getTokenPrices, getTokenSummaries } from "@/lib/basePrices";
import { allowWalletRead, walletReadLimited } from "../readLimit";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** POST { addresses } -> live prices + token summaries, same as /api/tokens/prices but without the Clerk gate (see docs/wallet.md). */
export async function POST(request: Request) {
  if (!await allowWalletRead(request, "prices", 60)) return walletReadLimited();
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const rawAddresses: unknown[] = Array.isArray(body.addresses) ? body.addresses : [];
  const addresses = rawAddresses.filter((address): address is string => typeof address === "string");
  // Addresses go into upstream URL paths and cache keys, so only real ones pass.
  if (addresses.length === 0 || addresses.length > 30 || !addresses.every((address) => ADDRESS_RE.test(address))) {
    return Response.json({ error: "Invalid addresses" }, { status: 400 });
  }

  const prices = await getTokenPrices(addresses);
  const tokens = await getTokenSummaries(addresses);
  return Response.json({ prices, tokens }, { headers: { "Cache-Control": "no-store" } });
}
