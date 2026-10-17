import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  noStoreJson,
  validateSessionMutation,
} from "@/app/api/session/responses";
import {
  APP_SESSION_COOKIE,
  consumeRateLimit,
  rateLimitKey,
  revokeAllAppSessions,
  SessionConfigurationError,
} from "@/lib/appSession";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";
import { requestIp } from "@/lib/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVOKE_ALL_IP_LIMIT = 5;
const REVOKE_ALL_WINDOW_MS = 5 * 60 * 1_000;

export async function DELETE(request: NextRequest) {
  if (!embeddedWalletAuthEnabled()) {
    return noStoreJson({ error: "Embedded wallet sign-in is not enabled" }, { status: 503 });
  }

  const invalidRequest = await validateSessionMutation(request);
  if (invalidRequest) return invalidRequest;

  const token = request.cookies.get(APP_SESSION_COOKIE)?.value;
  if (!token) return noStoreJson({ error: "Not signed in" }, { status: 401 });

  try {
    const ip = requestIp(request);
    const allowed = await consumeRateLimit(
      rateLimitKey("session-revoke-all:ip", ip),
      REVOKE_ALL_IP_LIMIT,
      REVOKE_ALL_WINDOW_MS,
    );
    if (!allowed) {
      return noStoreJson({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(REVOKE_ALL_WINDOW_MS / 1_000) },
      });
    }

    const revoked = await revokeAllAppSessions(token);
    if (!revoked) {
      const unauthorized = noStoreJson({ error: "Not signed in" }, { status: 401 });
      clearSessionCookie(unauthorized);
      return unauthorized;
    }

    const response = new NextResponse(null, { status: 204 });
    response.headers.set("Cache-Control", "no-store");
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return noStoreJson(
      {
        error: error instanceof SessionConfigurationError
          ? "Embedded wallet sign-in is not configured"
          : "Could not revoke application sessions",
      },
      { status: 503 },
    );
  }
}
