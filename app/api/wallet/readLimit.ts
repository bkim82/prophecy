import "server-only";

import { consumeRateLimit, rateLimitKey } from "@/lib/appSession";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";
import { requestIp } from "@/lib/requestSecurity";

export async function allowWalletRead(request: Request, scope: string, limit = 60) {
  // The transition fallback may not have SESSION_SECRET or the new schema yet.
  // Once embedded auth is active, every metered wallet read is fail-closed.
  if (!embeddedWalletAuthEnabled()) return true;
  return consumeRateLimit(
    rateLimitKey(`wallet-read:${scope}:ip`, requestIp(request)),
    limit,
    60_000,
  );
}

export function walletReadLimited() {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}
