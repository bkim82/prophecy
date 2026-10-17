import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, getDbMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: getDbMock }));

import { revokeAllAppSessions } from "@/lib/appSession";

describe("revokeAllAppSessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SESSION_SECRET = "s".repeat(32);
    getDbMock.mockReturnValue({ execute: executeMock });
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("returns the authenticated user and number of revoked sessions", async () => {
    executeMock.mockResolvedValue({
      rows: [{ user_id: "cdp-user", revoked_count: 3 }],
    });

    await expect(revokeAllAppSessions(
      "opaque-token",
      new Date("2026-10-17T12:00:00.000Z"),
    )).resolves.toEqual({ userId: "cdp-user", revokedCount: 3 });
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("fails closed when the presented session cannot identify a user", async () => {
    executeMock.mockResolvedValue({
      rows: [{ user_id: null, revoked_count: 0 }],
    });

    await expect(revokeAllAppSessions("invalid-token")).resolves.toBeNull();
  });
});
