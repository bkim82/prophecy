import { getNativeBalance } from "@/lib/alchemy";
import { allowWalletRead, walletReadLimited } from "../readLimit";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Public Base state for an address; wallet mutations never accept an address this way. */
export async function GET(request: Request) {
  if (!await allowWalletRead(request, "balance", 60)) return walletReadLimited();
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !ADDRESS_RE.test(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  try {
    const balance = await getNativeBalance(address);
    return Response.json({ balance }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Could not load balance" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
