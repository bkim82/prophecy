import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  noStoreJson,
  setSessionCookie,
  validateSessionMutation,
} from "@/app/api/session/responses";
import {
  APP_SESSION_COOKIE,
  consumeRateLimit,
  issueAppSession,
  rateLimitKey,
  revokeAppSession,
  SessionConfigurationError,
  SessionProvisionError,
} from "@/lib/appSession";
import { CdpConfigurationError, validateCdpAccessToken } from "@/lib/cdp";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";
import {
  AccountSelectionError,
  selectCanonicalEmbeddedWallet,
} from "@/lib/embeddedWalletAccount";
import {
  bearerToken,
  requestIp,
} from "@/lib/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_IP_LIMIT = 10;
const SESSION_USER_LIMIT = 10;
const SESSION_RATE_WINDOW_MS = 5 * 60 * 1_000;

function providerHttpStatus(error: unknown) {
  // @coinbase/cdp-sdk's APIError carries `statusCode`; the rest cover wrapped fetch errors.
  const candidate = error as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
    cause?: { status?: number; response?: { status?: number } };
  } | null;
  return candidate?.statusCode
    ?? candidate?.status
    ?? candidate?.response?.status
    ?? candidate?.cause?.status
    ?? candidate?.cause?.response?.status;
}

export async function POST(request: NextRequest) {
  if (!embeddedWalletAuthEnabled()) {
    return noStoreJson({ error: "Embedded wallet sign-in is not enabled" }, { status: 503 });
  }

  const invalidRequest = await validateSessionMutation(request);
  if (invalidRequest) return invalidRequest;

  const accessToken = bearerToken(request);
  if (!accessToken) {
    return noStoreJson({ error: "Missing or invalid bearer token" }, { status: 401 });
  }

  const ip = requestIp(request);
  try {
    const ipAllowed = await consumeRateLimit(
      rateLimitKey("session:ip", ip),
      SESSION_IP_LIMIT,
      SESSION_RATE_WINDOW_MS,
    );
    if (!ipAllowed) {
      return noStoreJson({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(SESSION_RATE_WINDOW_MS / 1_000) },
      });
    }

    let endUser;
    try {
      endUser = await validateCdpAccessToken(accessToken);
    } catch (error) {
      if (error instanceof CdpConfigurationError) throw error;
      const status = providerHttpStatus(error);
      if (status === 401 || status === 403) {
        return noStoreJson({ error: "Invalid or expired access token" }, { status: 401 });
      }
      return noStoreJson({ error: "Authentication provider unavailable" }, { status: 502 });
    }

    const userAllowed = await consumeRateLimit(
      rateLimitKey("session:user", endUser.userId),
      SESSION_USER_LIMIT,
      SESSION_RATE_WINDOW_MS,
    );
    if (!userAllowed) {
      return noStoreJson({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(SESSION_RATE_WINDOW_MS / 1_000) },
      });
    }

    const wallet = selectCanonicalEmbeddedWallet(endUser);
    const session = await issueAppSession(wallet, {
      ip,
      userAgent: request.headers.get("user-agent"),
    });
    const response = noStoreJson({
      user: {
        userId: session.userId,
        smartAccountAddress: session.smartAccountAddress,
        chainId: wallet.chainId,
      },
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AccountSelectionError) {
      return noStoreJson({ error: "A single supported smart account is required" }, { status: 409 });
    }
    if (error instanceof SessionProvisionError) {
      return noStoreJson({ error: "Canonical wallet conflicts with this account" }, { status: 409 });
    }
    if (error instanceof SessionConfigurationError || error instanceof CdpConfigurationError) {
      return noStoreJson({ error: "Embedded wallet sign-in is not configured" }, { status: 503 });
    }
    return noStoreJson({ error: "Could not create application session" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const invalidRequest = await validateSessionMutation(request);
  if (invalidRequest) return invalidRequest;

  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Cache-Control", "no-store");
  clearSessionCookie(response);

  const token = request.cookies.get(APP_SESSION_COOKIE)?.value;
  if (!token || !embeddedWalletAuthEnabled()) return response;

  try {
    const ip = requestIp(request);
    const allowed = await consumeRateLimit(
      rateLimitKey("session-delete:ip", ip),
      SESSION_IP_LIMIT,
      SESSION_RATE_WINDOW_MS,
    );
    if (!allowed) {
      const limited = noStoreJson({ error: "Too many requests" }, {
        status: 429,
        headers: { "Retry-After": String(SESSION_RATE_WINDOW_MS / 1_000) },
      });
      clearSessionCookie(limited);
      return limited;
    }
    await revokeAppSession(token);
    return response;
  } catch (error) {
    const unavailable = noStoreJson(
      {
        error: error instanceof SessionConfigurationError
          ? "Embedded wallet sign-in is not configured"
          : "Could not revoke application session",
      },
      { status: 503 },
    );
    clearSessionCookie(unavailable);
    return unavailable;
  }
}
