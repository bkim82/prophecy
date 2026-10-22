import { walletJson, walletMutationHeaderFailure, walletRateLimit } from "@/app/api/wallet/responses";
import { cancelTransactionIntent } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

/** Back/close on a review: cancels a created or confirmed intent; a claimed one is left alone. */
export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/cancel">) {
  const invalid = walletMutationHeaderFailure(request);
  if (invalid) return invalid;
  const viewer = await getViewer();
  if (!viewer) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-intent-cancel", 20)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const { id } = await context.params;
  const intent = await cancelTransactionIntent(viewer.userId, id);
  return intent
    ? walletJson({ intent })
    : walletJson({ error: "Intent is not cancelable" }, { status: 409 });
}
