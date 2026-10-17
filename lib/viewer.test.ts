import { beforeEach, describe, expect, it, vi } from "vitest";

const { appSessionViewerMock, authMock, cookiesMock, currentUserMock } = vi.hoisted(() => ({
  appSessionViewerMock: vi.fn(),
  authMock: vi.fn(),
  cookiesMock: vi.fn(),
  currentUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/appSession", () => ({
  APP_SESSION_COOKIE: "__Host-prophecy_session",
  appSessionViewer: appSessionViewerMock,
}));

import { getViewer, getViewerProfile } from "@/lib/viewer";

describe("getViewer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.EMBEDDED_WALLET_AUTH_ENABLED;
  });

  it("returns null when the provider session is signed out", async () => {
    authMock.mockResolvedValue({ userId: null });

    await expect(getViewer()).resolves.toBeNull();
  });

  it("returns the provider-neutral viewer shape", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });

    await expect(getViewer()).resolves.toEqual({
      userId: "user_123",
      smartAccountAddress: null,
    });
  });

  it("fails closed when profile identity differs from the viewer", async () => {
    currentUserMock.mockResolvedValue({ id: "user_other" });

    await expect(
      getViewerProfile({ userId: "user_123", smartAccountAddress: null }),
    ).resolves.toBeNull();
  });

  it("uses only the opaque application session when embedded-wallet auth is enabled", async () => {
    process.env.EMBEDDED_WALLET_AUTH_ENABLED = "true";
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "opaque-session-token" }),
    });
    appSessionViewerMock.mockResolvedValue({
      userId: "cdp-user-123",
      smartAccountAddress: `0x${"a".repeat(40)}`,
    });

    await expect(getViewer()).resolves.toEqual({
      userId: "cdp-user-123",
      smartAccountAddress: `0x${"a".repeat(40)}`,
    });
    expect(appSessionViewerMock).toHaveBeenCalledWith("opaque-session-token");
    expect(authMock).not.toHaveBeenCalled();
  });
});
