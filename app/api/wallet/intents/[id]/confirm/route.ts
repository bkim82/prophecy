import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { validateSessionMutation } from "@/app/api/session/responses";
import { walletJson, walletRateLimit } from "@/app/api/wallet/responses";
import { confirmTransactionIntent } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/confirm">) {
  const invalid = await validateSessionMutation(request);
  if (invalid) return invalid;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer?.smartAccountAddress) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-intent-confirm", 20)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const { id } = await context.params;
  const intent = await confirmTransactionIntent(
    viewer.userId,
    id,
    viewer.smartAccountAddress,
  );
  return intent
    ? walletJson({ intent })
    : walletJson({ error: "Intent is not confirmable" }, { status: 409 });
}
