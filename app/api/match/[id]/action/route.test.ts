import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMatchMock, getViewerMock, readBodyMock, roleOfMock } = vi.hoisted(() => ({
  findMatchMock: vi.fn(),
  getViewerMock: vi.fn(),
  readBodyMock: vi.fn(),
  roleOfMock: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));
vi.mock("@/lib/match", () => ({
  expireLocksIfDue: vi.fn(),
  findMatch: findMatchMock,
  pulsePositionsFor: vi.fn(),
  readBody: readBodyMock,
  roleOf: roleOfMock,
  settleIfDue: vi.fn(),
  viewFor: vi.fn(),
}));

import { POST } from "@/app/api/match/[id]/action/route";

const context = { params: Promise.resolve({ id: "match_123" }) };

describe("POST /api/match/[id]/action authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a signed-out mutation before reading its body", async () => {
    getViewerMock.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/match/match_123/action", { method: "POST" }), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to play" });
    expect(readBodyMock).not.toHaveBeenCalled();
  });

  it("denies a viewer whose session does not own the browser player", async () => {
    getViewerMock.mockResolvedValue({ userId: "user_attacker", smartAccountAddress: null });
    readBodyMock.mockResolvedValue({ playerId: "browser_victim", action: "enter" });
    findMatchMock.mockResolvedValue({
      id: "match_123",
      mode: "pulse",
      player1Id: "browser_victim",
      player1UserId: "user_victim",
    });
    roleOfMock.mockReturnValue(1);

    const response = await POST(new Request("http://localhost/api/match/match_123/action", { method: "POST" }), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Not in this match" });
  });
});
