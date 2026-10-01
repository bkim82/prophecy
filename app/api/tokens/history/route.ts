import { auth } from "@clerk/nextjs/server";
import { getTokenHistories } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/**
 * POST { addresses, cachedOnly? } → ~24h of hourly closes per address
 * (oldest first) for sparklines/charts. Addresses with no history are
 * omitted. `cachedOnly` never triggers an upstream fetch (search results).
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

  const history = await getTokenHistories(addresses, body.cachedOnly === true);
  return Response.json({ history }, { headers: { "Cache-Control": "no-store" } });
}
