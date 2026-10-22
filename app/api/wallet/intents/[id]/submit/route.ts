import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { validateSessionMutation } from "@/app/api/session/responses";
import { walletAccountRequired, walletJson, walletRateLimit, walletSignedOut } from "@/app/api/wallet/responses";
import { claimTransactionIntent, type ClaimRefusal } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

/** Shown to the user as-is; nothing was signed in any of these cases. */
const REFUSAL_MESSAGES: Record<ClaimRefusal, string> = {
  "not-submittable": "This confirmation expired or was already used. Nothing was signed; review it again.",
  "call-mismatch": "The prepared operation failed its final check. Nothing was signed.",
  "call-hash-mismatch": "The prepared operation failed its final check. Nothing was signed.",
  "daily-limit": "This would go over today's limit for this token. Nothing was signed.",
};

export async function POST(request: Request, context: RouteContext<"/api/wallet/intents/[id]/submit">) {
  const invalid = await validateSessionMutation(request);
  if (invalid) return invalid;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer) return walletSignedOut();
  if (!viewer.smartAccountAddress) return walletAccountRequired();
  if (!await walletRateLimit(request, viewer, "wallet-intent-submit", 10)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const { id } = await context.params;
  const claim = await claimTransactionIntent(viewer.userId, id, viewer.smartAccountAddress);
  if ("refused" in claim) {
    return walletJson({ error: REFUSAL_MESSAGES[claim.refused], code: claim.refused }, { status: 409 });
  }
  const { intent } = claim;
  return walletJson({
    intent: {
      id: intent.id,
      kind: intent.kind,
      chainId: intent.chainId,
      smartAccountAddress: intent.smartAccountAddress,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      recipient: intent.recipient,
      inputAmount: intent.inputAmount,
      minimumOutputAmount: intent.minimumOutputAmount,
      calls: intent.calls,
      normalizedCallHash: intent.normalizedCallHash,
    },
  });
}
