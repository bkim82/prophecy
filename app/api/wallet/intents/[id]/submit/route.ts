import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { validateSessionMutation } from "@/app/api/session/responses";
import { walletJson, walletRateLimit } from "@/app/api/wallet/responses";
import { claimTransactionIntent } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/submit">) {
  const invalid = await validateSessionMutation(request);
  if (invalid) return invalid;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  if (process.env.CDP_PAYMASTER_DECODER_VERIFIED !== "true") {
    return walletJson({ error: "Sponsorship policy is not verified" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer?.smartAccountAddress) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-intent-submit", 10)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const { id } = await context.params;
  const intent = await claimTransactionIntent(viewer.userId, id, viewer.smartAccountAddress);
  return intent
    ? walletJson({
        intent: {
          id: intent.id,
          kind: intent.kind,
          chainId: intent.chainId,
          smartAccountAddress: intent.smartAccountAddress,
          tokenIn: intent.tokenIn,
          recipient: intent.recipient,
          inputAmount: intent.inputAmount,
          calls: intent.calls,
          normalizedCallHash: intent.normalizedCallHash,
        },
      })
    : walletJson({ error: "Intent is not submittable" }, { status: 409 });
}
