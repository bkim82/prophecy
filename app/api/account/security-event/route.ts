import {
  WalletRequestError,
  readWalletJson,
  walletJson,
  walletMutationHeaderFailure,
  walletRateLimit,
} from "@/app/api/wallet/responses";
import { auditWalletEvent } from "@/lib/transactionIntents";
import { getViewer } from "@/lib/viewer";

const ALLOWED_EVENTS = new Set([
  "auth.method_linked",
  "mfa.enrolled",
  "session.revoke_all_requested",
]);

export async function POST(request: Request) {
  const invalid = walletMutationHeaderFailure(request);
  if (invalid) return invalid;
  const viewer = await getViewer();
  if (!viewer) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "account-security-event", 12)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = await readWalletJson(request);
    if (typeof body.event !== "string" || !ALLOWED_EVENTS.has(body.event)) {
      return walletJson({ error: "Invalid security event" }, { status: 400 });
    }
    await auditWalletEvent(body.event, viewer.userId, null);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WalletRequestError) {
      return walletJson({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
