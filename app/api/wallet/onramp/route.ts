import { walletServerOnrampEnabled } from "@/app/lib/embeddedWallet/config";
import {
  WalletRequestError,
  readWalletJson,
  walletAccountRequired,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
  walletSignedOut,
} from "@/app/api/wallet/responses";
import { CdpConfigurationError, CdpOnrampError } from "@/lib/cdp";
import { createUsdcOnrampSession, validOnrampAmount } from "@/lib/onramp";
import { requestIp } from "@/lib/requestSecurity";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * Body: `{ amount?: "25" }` (USD). Destination, network, and asset are fixed
 * server-side to the viewer's smart account, Base, and USDC; any other body
 * field is ignored. Returns `{ url }`, a single-use Coinbase checkout link.
 */
export async function POST(request: Request) {
  const headerFailure = walletMutationHeaderFailure(request);
  if (headerFailure) return headerFailure;
  if (!walletServerOnrampEnabled()) {
    return walletJson({ error: "Card purchases are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer) return walletSignedOut();
  if (!viewer.smartAccountAddress) return walletAccountRequired();
  if (!await walletRateLimit(request, viewer, "wallet-onramp-session", 6)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await readWalletJson(request);
    if (body.amount !== undefined && (typeof body.amount !== "string" || !validOnrampAmount(body.amount))) {
      return walletJson({ error: "Enter a dollar amount like 25 or 25.50" }, { status: 400 });
    }
    const ip = requestIp(request);
    const session = await createUsdcOnrampSession({
      userId: viewer.userId,
      smartAccountAddress: viewer.smartAccountAddress,
      paymentAmount: body.amount as string | undefined,
      redirectUrl: new URL("/wallet", process.env.APP_ORIGIN || request.url).toString(),
      clientIp: ip === "unknown" ? undefined : ip,
    });
    return walletJson({ url: session.url }, { status: 201 });
  } catch (error) {
    if (error instanceof WalletRequestError) {
      return walletJson({ error: error.code }, { status: error.status });
    }
    if (error instanceof CdpConfigurationError) {
      return walletJson({ error: "Card purchases are not configured" }, { status: 503 });
    }
    if (error instanceof CdpOnrampError) {
      return walletJson({ error: "Coinbase couldn't start checkout. Try again." }, { status: 502 });
    }
    throw error;
  }
}
