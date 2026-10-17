import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { IntentValidationError } from "@/app/lib/embeddedWallet/intents";
import {
  WalletRequestError,
  readWalletJson,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
} from "@/app/api/wallet/responses";
import { createSendIntent, listTransactionIntents } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return walletJson({ error: "Not signed in" }, { status: 401 });
  const intents = await listTransactionIntents(viewer.userId);
  return walletJson({ intents });
}

export async function POST(request: Request) {
  const headerFailure = walletMutationHeaderFailure(request);
  if (headerFailure) return headerFailure;
  if (!walletServerTransactionsEnabled()) {
    return walletJson({ error: "Wallet transactions are disabled" }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer?.smartAccountAddress) {
    return walletJson({ error: "A canonical smart account is required" }, { status: 401 });
  }
  if (!await walletRateLimit(request, viewer, "wallet-intent-create", 12)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await readWalletJson(request);
    if (body.kind !== "send") {
      return walletJson({ error: "Only curated send intents are enabled" }, { status: 400 });
    }
    if (
      typeof body.idempotencyKey !== "string"
      || typeof body.tokenAddress !== "string"
      || typeof body.recipient !== "string"
      || typeof body.amount !== "string"
    ) {
      return walletJson({ error: "Invalid send intent" }, { status: 400 });
    }
    const intent = await createSendIntent(viewer.userId, viewer.smartAccountAddress, {
      idempotencyKey: body.idempotencyKey,
      tokenAddress: body.tokenAddress,
      recipient: body.recipient,
      amount: body.amount,
    });
    return walletJson({ intent }, { status: intent.status === "created" ? 201 : 200 });
  } catch (error) {
    if (error instanceof IntentValidationError) {
      return walletJson({ error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof WalletRequestError) {
      return walletJson({ error: error.code }, { status: error.status });
    }
    if (error instanceof Error && error.message === "idempotency-conflict") {
      return walletJson({ error: "Operation id was already used for different details" }, { status: 409 });
    }
    throw error;
  }
}
