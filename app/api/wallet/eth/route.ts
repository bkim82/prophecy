import { getTokenSummaries } from "@/lib/basePrices";

export const dynamic = "force-dynamic";

// Base's wrapped ETH pool stands in for native ETH's market data (price,
// 24h change, logo) — native ETH itself has no DexScreener/GeckoTerminal
// pool to read from, but it tracks WETH 1:1.
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

/** GET -> ETH's live price/24h-change/logo via its WETH proxy. No auth: public market data, same as /api/wallet/holdings. */
export async function GET() {
  const [summary] = await getTokenSummaries([BASE_WETH_ADDRESS]);
  if (!summary) return Response.json({ eth: null }, { headers: { "Cache-Control": "no-store" } });

  const eth = { ...summary, address: "eth", symbol: "ETH", name: "Ether" };
  return Response.json({ eth }, { headers: { "Cache-Control": "no-store" } });
}
