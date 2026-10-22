import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { IntentValidationError, parseMinimumOutput } from "@/app/lib/embeddedWallet/intents";
import {
  WalletRequestError,
  readWalletJson,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
} from "@/app/api/wallet/responses";
import { confirmTransactionIntent } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

/** Body `{}` for a send; `{ minimumOutputAmount }` (raw, from the reviewed quote) for a swap. */
export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/confirm">) {
  const invalid = walletMutationHeaderFailure(request);
  if (invalid) return invalid;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer?.smartAccountAddress) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-intent-confirm", 20)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = await readWalletJson(request);
    const minimumOutputAmount = body.minimumOutputAmount === undefined
      ? null
      : parseMinimumOutput(body.minimumOutputAmount);
    const { id } = await context.params;
    const intent = await confirmTransactionIntent(
      viewer.userId,
      id,
      viewer.smartAccountAddress,
      minimumOutputAmount,
    );
    return intent
      ? walletJson({ intent })
      : walletJson({ error: "Intent is not confirmable" }, { status: 409 });
  } catch (error) {
    if (error instanceof IntentValidationError) {
      return walletJson({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof WalletRequestError) {
      return walletJson({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
