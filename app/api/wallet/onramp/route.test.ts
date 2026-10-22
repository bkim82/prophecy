import { beforeEach, describe, expect, it, vi } from "vitest";

const { createUsdcOnrampSessionMock, getViewerMock } = vi.hoisted(() => ({
  createUsdcOnrampSessionMock: vi.fn(),
  getViewerMock: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));
vi.mock("@/lib/onramp", async () => ({
  ...await vi.importActual<object>("@/lib/onramp"),
  createUsdcOnrampSession: createUsdcOnrampSessionMock,
}));
vi.mock("@/lib/cdp", () => ({
  CdpConfigurationError: class extends Error {},
  CdpOnrampError: class extends Error {},
}));
vi.mock("@/lib/appSession", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  rateLimitKey: (scope: string, subject: string) => `${scope}:${subject}`,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/transactionIntents", () => ({ auditWalletEvent: vi.fn() }));

import { POST } from "@/app/api/wallet/onramp/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const ATTACKER = "0x2222222222222222222222222222222222222222";

const request = (body: Record<string, unknown>) => new Request("https://prophecy.test/api/wallet/onramp", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://prophecy.test", Host: "prophecy.test" },
  body: JSON.stringify(body),
});

describe("POST /api/wallet/onramp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("WALLET_ONRAMP_ENABLED", "true");
    getViewerMock.mockResolvedValue({ userId: "user-1", smartAccountAddress: ACCOUNT });
    createUsdcOnrampSessionMock.mockResolvedValue({ id: "order-1", url: "https://pay.coinbase.com/buy?sessionToken=x" });
  });

  it("is closed unless the server gate is on", async () => {
    vi.stubEnv("WALLET_ONRAMP_ENABLED", "");
    const response = await POST(request({}));
    expect(response.status).toBe(503);
    expect(createUsdcOnrampSessionMock).not.toHaveBeenCalled();
  });

  it("always delivers to the viewer's smart account, ignoring a client destination", async () => {
    const response = await POST(request({ amount: "25", destinationAddress: ATTACKER, destinationNetwork: "ethereum" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ url: "https://pay.coinbase.com/buy?sessionToken=x" });
    expect(createUsdcOnrampSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      smartAccountAddress: ACCOUNT,
      paymentAmount: "25",
      redirectUrl: "https://prophecy.test/wallet",
    }));
  });

  it("rejects malformed amounts", async () => {
    for (const amount of ["0", "-5", "1e3", "12.345", 25]) {
      const response = await POST(request({ amount }));
      expect(response.status).toBe(400);
    }
    expect(createUsdcOnrampSessionMock).not.toHaveBeenCalled();
  });

  it("requires a smart account", async () => {
    getViewerMock.mockResolvedValue({ userId: "user-1", smartAccountAddress: null });
    expect((await POST(request({}))).status).toBe(403);
    getViewerMock.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(401);
  });
});
