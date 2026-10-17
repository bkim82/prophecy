import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  consumeRateLimitMock,
  revokeAllAppSessionsMock,
} = vi.hoisted(() => ({
  consumeRateLimitMock: vi.fn(),
  revokeAllAppSessionsMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/appSession", () => {
  class SessionConfigurationError extends Error {}
  return {
    APP_SESSION_COOKIE: "__Host-prophecy_session",
    consumeRateLimit: consumeRateLimitMock,
    rateLimitKey: (scope: string, subject: string) => `${scope}:${subject}`,
    revokeAllAppSessions: revokeAllAppSessionsMock,
    SessionConfigurationError,
  };
});

import { DELETE } from "@/app/api/session/all/route";

function request(options: { body?: string; cookie?: string; origin?: string } = {}) {
  const headers = new Headers({
    origin: options.origin ?? "http://localhost",
    host: "localhost",
    "content-type": "application/json",
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  return new NextRequest("http://localhost/api/session/all", {
    method: "DELETE",
    headers,
    body: options.body ?? "{}",
  });
}

describe("revoke-all application sessions route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.EMBEDDED_WALLET_AUTH_ENABLED = "true";
    consumeRateLimitMock.mockResolvedValue(true);
    revokeAllAppSessionsMock.mockResolvedValue({
      userId: "cdp-user",
      revokedCount: 2,
    });
  });

  afterEach(() => {
    delete process.env.EMBEDDED_WALLET_AUTH_ENABLED;
  });

  it("revokes every session and clears the current cookie", async () => {
    const response = await DELETE(request({
      cookie: "__Host-prophecy_session=opaque-token",
    }));

    expect(response.status).toBe(204);
    expect(revokeAllAppSessionsMock).toHaveBeenCalledWith("opaque-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-prophecy_session=");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("rejects cross-origin requests before touching session state", async () => {
    const response = await DELETE(request({
      cookie: "__Host-prophecy_session=opaque-token",
      origin: "https://attacker.test",
    }));

    expect(response.status).toBe(403);
    expect(revokeAllAppSessionsMock).not.toHaveBeenCalled();
  });

  it("requires a current application session", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(consumeRateLimitMock).not.toHaveBeenCalled();
  });

  it("fails closed and clears an invalid session cookie", async () => {
    revokeAllAppSessionsMock.mockResolvedValue(null);
    const response = await DELETE(request({
      cookie: "__Host-prophecy_session=invalid-token",
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("__Host-prophecy_session=");
  });

  it("rate limits before querying session state", async () => {
    consumeRateLimitMock.mockResolvedValue(false);
    const response = await DELETE(request({
      cookie: "__Host-prophecy_session=opaque-token",
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(revokeAllAppSessionsMock).not.toHaveBeenCalled();
  });

  it("stays unavailable until embedded auth is enabled", async () => {
    delete process.env.EMBEDDED_WALLET_AUTH_ENABLED;
    const response = await DELETE(request({
      cookie: "__Host-prophecy_session=opaque-token",
    }));

    expect(response.status).toBe(503);
    expect(revokeAllAppSessionsMock).not.toHaveBeenCalled();
  });
});
