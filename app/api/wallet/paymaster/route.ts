import { walletJson } from "@/app/api/wallet/responses";
import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";

export const dynamic = "force-dynamic";

/**
 * Fail-closed boundary. The forwarding implementation is intentionally not
 * reachable until the credentialed Base Sepolia spike records and tests the
 * installed smart-account batch decoder. Passing an upstream URL alone can
 * never turn this into an open sponsorship relay.
 */
export async function POST() {
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  return walletJson(
    { error: "Paymaster call decoder has not passed the credentialed launch gate" },
    { status: 503 },
  );
}
