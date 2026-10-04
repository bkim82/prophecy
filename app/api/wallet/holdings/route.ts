import { getWalletHoldings } from "@/lib/alchemy";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** GET ?address=0x... -> real Base ERC-20 holdings for that address. Public on-chain data, no auth. */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !ADDRESS_RE.test(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }

  const holdings = await getWalletHoldings(address);
  return Response.json({ holdings }, { headers: { "Cache-Control": "no-store" } });
}
