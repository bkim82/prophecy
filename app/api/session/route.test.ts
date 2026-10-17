import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  consumeRateLimitMock,
  issueAppSessionMock,
  revokeAppSessionMock,
  validateCdpAccessTokenMock,
} = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  issueAppSessionMock: vi.fn(),
  revokeAppSessionMock: vi.fn(),
  validateCdpAccessTokenMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/appSession", () => {
  class SessionConfigurationError extends Error {}
  class SessionProvisionError extends Error {}
  return {
    APP_SESSION_COOKIE: "__Host-prophecy_session",
    consumeRateLimit: consumeRateLimitMock,
    issueAppSession: issueAppSessionMock,
    rateLimitKey: (scope: string, subject: string) => `${scope}:${subject}`,
    revokeAppSession: revokeAppSessionMock,
    SessionConfigurationError,
    SessionProvisionError,
  };
});
vi.mock("@/lib/cdp", () => {
  class CdpConfigurationError extends Error {}
  return {
    CdpConfigurationError,
    validateCdpAccessToken: validateCdpAccessTokenMock,
  };
});

import { DELETE, POST } from "@/app/api/session/route";

const owner = `0x${"a".repeat(40)}`;
const smartAccountAddress = `0x${"b".repeat(40)}`;
const validEndUser = {
  userId: "cdp-user-123",
  createdAt: "2026-10-01T00:00:00.000Z",
  evmAccountObjects: [{ address: owner, createdAt: "2026-10-01T00:00:00.000Z" }],
  evmSmartAccountObjects: [{
    address: smartAccountAddress,
    ownerAddresses: [owner],
    createdAt: "2026-10-01T00:00:01.000Z",
  }],
};

function sessionRequest(
  method: "POST" | "DELETE",
  options: { body?: string; authorization?: string; origin?: string; cookie?: string } = {},
) {
  const headers = new Headers({
    origin: options.origin ?? "http://localhost",
    host: "localhost",
    "content-type": "application/json",
  });
  if (options.authorization) headers.set("authorization", options.authorization);
  if (options.cookie) headers.set("cookie", options.cookie);
  return new NextRequest("http://localhost/api/session", {
    method,
    headers,
    body: options.body ?? "{}",
  });
}

describe("application session route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.EMBEDDED_WALLET_AUTH_ENABLED = "true";
    consumeRateLimitMock.mockResolvedValue(true);
    validateCdpAccessTokenMock.mockResolvedValue(validEndUser);
    issueAppSessionMock.mockResolvedValue({
      token: "opaque-session-token",
      expiresAt: new Date("2026-10-08T00:00:00.000Z"),
      userId: validEndUser.userId,
      smartAccountAddress,
    });
  });

  afterEach(() => {
    delete process.env.EMBEDDED_WALLET_AUTH_ENABLED;
  });

  it("validates the bearer token and sets a hardened opaque session cookie", async () => {
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
    }));

    expect(response.status).toBe(200);
    expect(validateCdpAccessTokenMock).toHaveBeenCalledWith("provider-access-token");
    expect(issueAppSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: validEndUser.userId,
        smartAccountAddress,
        chainId: 8453,
      }),
      expect.objectContaining({ ip: "unknown" }),
    );
    await expect(response.json()).resolves.toEqual({
      user: { userId: validEndUser.userId, smartAccountAddress, chainId: 8453 },
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-prophecy_session=opaque-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("stays unavailable until the feature gate is explicitly enabled", async () => {
    delete process.env.EMBEDDED_WALLET_AUTH_ENABLED;
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
    }));

    expect(response.status).toBe(503);
    expect(validateCdpAccessTokenMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before validating a provider token", async () => {
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
      origin: "https://attacker.test",
    }));

    expect(response.status).toBe(403);
    expect(validateCdpAccessTokenMock).not.toHaveBeenCalled();
  });

  it("rejects provider tokens supplied in the request body", async () => {
    const response = await POST(sessionRequest("POST", {
      body: JSON.stringify({ accessToken: "provider-access-token" }),
    }));

    expect(response.status).toBe(400);
    expect(validateCdpAccessTokenMock).not.toHaveBeenCalled();
  });

  it("does not create a session for an ambiguous smart account", async () => {
    validateCdpAccessTokenMock.mockResolvedValue({
      ...validEndUser,
      evmSmartAccountObjects: [
        validEndUser.evmSmartAccountObjects[0],
        { ...validEndUser.evmSmartAccountObjects[0], address: `0x${"c".repeat(40)}` },
      ],
    });
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
    }));

    expect(response.status).toBe(409);
    expect(issueAppSessionMock).not.toHaveBeenCalled();
  });

  it("maps a CDP SDK 401 (statusCode) to an invalid-token response", async () => {
    // Shape observed from @coinbase/cdp-sdk APIError on a malformed token.
    validateCdpAccessTokenMock.mockRejectedValue(
      Object.assign(new Error("Failed to parse JWT token"), { statusCode: 401, errorType: "unauthorized" }),
    );
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
    }));

    expect(response.status).toBe(401);
    expect(issueAppSessionMock).not.toHaveBeenCalled();
  });

  it("rate limits before calling the provider", async () => {
    consumeRateLimitMock.mockResolvedValueOnce(false);
    const response = await POST(sessionRequest("POST", {
      authorization: "Bearer provider-access-token",
    }));

    expect(response.status).toBe(429);
    expect(validateCdpAccessTokenMock).not.toHaveBeenCalled();
  });

  it("revokes the database session and clears the cookie", async () => {
    const response = await DELETE(sessionRequest("DELETE", {
      cookie: "__Host-prophecy_session=opaque-session-token",
    }));

    expect(response.status).toBe(204);
    expect(revokeAppSessionMock).toHaveBeenCalledWith("opaque-session-token");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-prophecy_session=");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });
});
