import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import {
  WalletRequestError,
  readWalletJson,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
  walletSignedOut,
} from "@/app/api/wallet/responses";
import { recordUserOperationHash } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/broadcast">) {
  const invalid = walletMutationHeaderFailure(request);
  if (invalid) return invalid;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer) return walletSignedOut();
  if (!await walletRateLimit(request, viewer, "wallet-intent-broadcast", 20)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = await readWalletJson(request);
    if (typeof body.userOperationHash !== "string") {
      return walletJson({ error: "Invalid user operation hash" }, { status: 400 });
    }
    const { id } = await context.params;
    const intent = await recordUserOperationHash(viewer.userId, id, body.userOperationHash);
    return intent
      ? walletJson({ intent })
      : walletJson({ error: "Intent is not awaiting a user operation" }, { status: 409 });
  } catch (error) {
    if (error instanceof WalletRequestError) {
      return walletJson({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
