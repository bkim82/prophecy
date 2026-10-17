import { validateSessionMutation } from "@/app/api/session/responses";
import { walletJson, walletRateLimit } from "@/app/api/wallet/responses";
import { reconcileTransactionIntents } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

export async function POST(request: Request) {
  const invalid = await validateSessionMutation(request);
  if (invalid) return invalid;
  const viewer = await getViewer();
  if (!viewer) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-reconcile", 12)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const intents = await reconcileTransactionIntents(viewer.userId);
  return walletJson({ intents });
}
