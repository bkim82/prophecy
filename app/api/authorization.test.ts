import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewerMock } = vi.hoisted(() => ({ getViewerMock: vi.fn() }));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));

import { GET as getBalance } from "@/app/api/balance/route";
import { POST as findOrCreateMatch } from "@/app/api/match/find-or-create/route";
import { GET as getPortfolioSession } from "@/app/api/portfolio/session/route";

describe("viewer-gated route compatibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getViewerMock.mockResolvedValue(null);
  });

  it("preserves the balance route's signed-out response", async () => {
    const response = await getBalance();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Not signed in" });
  });

  it("preserves the matchmaker's signed-out response", async () => {
    const response = await findOrCreateMatch(
      new Request("http://localhost/api/match/find-or-create", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to play" });
  });

  it("preserves the portfolio route's signed-out response", async () => {
    const response = await getPortfolioSession();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to play" });
  });
});
