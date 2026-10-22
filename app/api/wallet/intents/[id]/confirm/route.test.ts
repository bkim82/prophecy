import { beforeEach, describe, expect, it, vi } from "vitest";

const { confirmTransactionIntentMock, getViewerMock } = vi.hoisted(() => ({
  confirmTransactionIntentMock: vi.fn(),
  getViewerMock: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));
vi.mock("@/lib/transactionIntents", () => ({ confirmTransactionIntent: confirmTransactionIntentMock }));
vi.mock("@/lib/appSession", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  rateLimitKey: (scope: string, subject: string) => `${scope}:${subject}`,
}));

import { POST } from "@/app/api/wallet/intents/[id]/confirm/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const context = { params: Promise.resolve({ id: "intent-1" }) } as unknown as Parameters<typeof POST>[1];

const request = (body: Record<string, unknown>) => new Request("https://prophecy.test/api/wallet/intents/intent-1/confirm", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://prophecy.test", Host: "prophecy.test" },
  body: JSON.stringify(body),
});

describe("POST /api/wallet/intents/[id]/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WALLET_TRANSACTIONS_ENABLED", "true");
    getViewerMock.mockResolvedValue({ userId: "user-1", smartAccountAddress: ACCOUNT });
    confirmTransactionIntentMock.mockResolvedValue({ id: "intent-1", status: "confirmed_by_user" });
  });

  it("confirms a send with no minimum output", async () => {
    expect((await POST(request({}), context)).status).toBe(200);
    expect(confirmTransactionIntentMock).toHaveBeenCalledWith("user-1", "intent-1", ACCOUNT, null);
  });

  it("records a swap's reviewed raw minimum output", async () => {
    expect((await POST(request({ minimumOutputAmount: "24750000" }), context)).status).toBe(200);
    expect(confirmTransactionIntentMock).toHaveBeenCalledWith("user-1", "intent-1", ACCOUNT, "24750000");
  });

  it("rejects a malformed minimum output without confirming", async () => {
    for (const minimumOutputAmount of ["0", "1.5", "-1", 5, "0x10"]) {
      expect((await POST(request({ minimumOutputAmount }), context)).status).toBe(400);
    }
    expect(confirmTransactionIntentMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the intent is not confirmable (wrong kind or status)", async () => {
    confirmTransactionIntentMock.mockResolvedValue(null);
    expect((await POST(request({ minimumOutputAmount: "1" }), context)).status).toBe(409);
  });
});
