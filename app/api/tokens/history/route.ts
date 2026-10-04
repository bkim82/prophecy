import { auth } from "@clerk/nextjs/server";
import { getTokenHistories, isHistoryPeriod } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

/**
 * POST { addresses, cachedOnly?, period? } → closes per address (oldest
 * first) for sparklines/charts; `period` is 1h/24h/7d/30d, default 24h
 * (hourly). Addresses with no history are omitted; `retry` lists the ones
 * that couldn't be fetched right now (upstream budget/rate limit) and are
 * worth asking for again, and `retryAfterMs` (when the budget is the cause)
 * says when. `cachedOnly` never triggers an upstream fetch.
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

  if (body.period !== undefined && !isHistoryPeriod(body.period)) {
    return Response.json({ error: "Invalid period" }, { status: 400 });
  }

  const { history, retry, retryAfterMs } = await getTokenHistories(addresses, body.cachedOnly === true, body.period ?? "24h");
  return Response.json({ history, retry, retryAfterMs }, { headers: { "Cache-Control": "no-store" } });
}
