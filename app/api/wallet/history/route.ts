import { getTokenHistories, isHistoryPeriod } from "@/lib/tokenHistory";

export const dynamic = "force-dynamic";

const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const ETH_SENTINEL = "eth";

/**
 * POST { addresses, period? } -> closes per address (oldest first), same
 * shape as /api/tokens/history but without the Clerk gate — the wallet
 * dashboard has no sign-in requirement, only a connected wallet (see
 * /api/wallet/holdings). The "eth" sentinel address is resolved through
 * WETH's pool and mapped back to "eth" in the response.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const rawAddresses: unknown[] = Array.isArray(body.addresses) ? body.addresses : [];
  const requested = rawAddresses.filter((address): address is string => typeof address === "string");
  if (requested.length === 0 || requested.length > 30) {
    return Response.json({ error: "Invalid addresses" }, { status: 400 });
  }
  if (body.period !== undefined && !isHistoryPeriod(body.period)) {
    return Response.json({ error: "Invalid period" }, { status: 400 });
  }

  const wantsEth = requested.some((address) => address.toLowerCase() === ETH_SENTINEL);
  const queried = requested.map((address) => (address.toLowerCase() === ETH_SENTINEL ? BASE_WETH_ADDRESS : address));

  const { history, retry, retryAfterMs } = await getTokenHistories(queried, body.cachedOnly === true, body.period ?? "24h");
  if (wantsEth && history[BASE_WETH_ADDRESS]) {
    history[ETH_SENTINEL] = history[BASE_WETH_ADDRESS];
    delete history[BASE_WETH_ADDRESS];
  }
  const remappedRetry = retry.map((address) => (address === BASE_WETH_ADDRESS ? ETH_SENTINEL : address));

  return Response.json({ history, retry: remappedRetry, retryAfterMs }, { headers: { "Cache-Control": "no-store" } });
}
