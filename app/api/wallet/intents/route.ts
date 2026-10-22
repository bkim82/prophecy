import { walletServerTransactionsEnabled } from "@/app/lib/embeddedWallet/config";
import { IntentValidationError } from "@/app/lib/embeddedWallet/intents";
import {
  WalletRequestError,
  readWalletJson,
  walletAccountRequired,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
  walletSignedOut,
} from "@/app/api/wallet/responses";
import { createSendIntent, createSwapIntent, listTransactionIntents } from "@/lib/transactionIntents";
import { normalizeHandle } from "@/app/lib/profileEdit";
import { walletAddressForHandle } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return walletSignedOut();
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
  if (!viewer) return walletSignedOut();
  if (!viewer.smartAccountAddress) return walletAccountRequired();
  if (!await walletRateLimit(request, viewer, "wallet-intent-create", 12)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await readWalletJson(request);
    if (body.kind === "swap") {
      if (
        typeof body.idempotencyKey !== "string"
        || typeof body.fromToken !== "string"
        || typeof body.toToken !== "string"
        || typeof body.amount !== "string"
      ) {
        return walletJson({ error: "Invalid swap intent" }, { status: 400 });
      }
      const swap = await createSwapIntent(viewer.userId, viewer.smartAccountAddress, {
        idempotencyKey: body.idempotencyKey,
        fromToken: body.fromToken,
        toToken: body.toToken,
        amount: body.amount,
      });
      return walletJson(swap, { status: swap.intent.status === "created" ? 201 : 200 });
    }
    if (body.kind !== "send") {
      return walletJson({ error: "Only send and swap intents are enabled" }, { status: 400 });
    }
    // Exactly one of a pasted address or a picked @handle. A handle is resolved
    // only here; the returned intent carries the address (the review shows it and
    // the browser signs to it), so each lookup costs a rate-limited, audited intent.
    const byHandle = typeof body.recipientHandle === "string";
    if (
      typeof body.idempotencyKey !== "string"
      || typeof body.tokenAddress !== "string"
      || typeof body.amount !== "string"
      || byHandle === (typeof body.recipient === "string")
    ) {
      return walletJson({ error: "Invalid send intent" }, { status: 400 });
    }
    const recipient = byHandle
      ? await walletAddressForHandle(normalizeHandle(body.recipientHandle as string))
      : body.recipient as string;
    if (!recipient) {
      return walletJson({ error: "That @handle doesn't have a Prophecy wallet. Pick the recipient again." }, { status: 409 });
    }
    const send = await createSendIntent(viewer.userId, viewer.smartAccountAddress, {
      idempotencyKey: body.idempotencyKey,
      tokenAddress: body.tokenAddress,
      recipient,
      amount: body.amount,
    });
    return walletJson(send, { status: send.intent.status === "created" ? 201 : 200 });
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
