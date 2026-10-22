import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSendIntentMock, getViewerMock, walletAddressForHandleMock } = vi.hoisted(() => ({
  createSendIntentMock: vi.fn(),
  getViewerMock: vi.fn(),
  walletAddressForHandleMock: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));
vi.mock("@/lib/profile", () => ({ walletAddressForHandle: walletAddressForHandleMock }));
vi.mock("@/lib/transactionIntents", () => ({
  createSendIntent: createSendIntentMock,
  createSwapIntent: vi.fn(),
  listTransactionIntents: vi.fn(),
}));
vi.mock("@/lib/appSession", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  rateLimitKey: (scope: string, subject: string) => `${scope}:${subject}`,
}));

import { POST } from "@/app/api/wallet/intents/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const request = (body: Record<string, unknown>) => new Request("https://prophecy.test/api/wallet/intents", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://prophecy.test", Host: "prophecy.test" },
  body: JSON.stringify({ kind: "send", idempotencyKey: "abcdefghijklmnop", tokenAddress: USDC, amount: "1", ...body }),
});

describe("POST /api/wallet/intents (send recipients)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WALLET_TRANSACTIONS_ENABLED", "true");
    getViewerMock.mockResolvedValue({ userId: "user-1", smartAccountAddress: ACCOUNT });
    createSendIntentMock.mockResolvedValue({ intent: { status: "created" }, token: { address: USDC, symbol: "USDC", decimals: 6 } });
  });

  it("resolves a picked @handle to its wallet on the server", async () => {
    walletAddressForHandleMock.mockResolvedValue(RECIPIENT);
    const response = await POST(request({ recipientHandle: "@Alice" }));
    expect(response.status).toBe(201);
    expect(walletAddressForHandleMock).toHaveBeenCalledWith("alice");
    expect(createSendIntentMock).toHaveBeenCalledWith("user-1", ACCOUNT, expect.objectContaining({ recipient: RECIPIENT }));
  });

  it("rejects a handle with no active wallet", async () => {
    walletAddressForHandleMock.mockResolvedValue(null);
    const response = await POST(request({ recipientHandle: "ghost" }));
    expect(response.status).toBe(409);
    expect(createSendIntentMock).not.toHaveBeenCalled();
  });

  it("requires exactly one of recipient or recipientHandle", async () => {
    expect((await POST(request({ recipient: RECIPIENT, recipientHandle: "alice" }))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
    expect(createSendIntentMock).not.toHaveBeenCalled();
  });

  it("passes a pasted address through unresolved", async () => {
    const response = await POST(request({ recipient: RECIPIENT }));
    expect(response.status).toBe(201);
    expect(walletAddressForHandleMock).not.toHaveBeenCalled();
    expect(createSendIntentMock).toHaveBeenCalledWith("user-1", ACCOUNT, expect.objectContaining({ recipient: RECIPIENT }));
  });

  it("tells the browser to sign out when the app session is gone", async () => {
    getViewerMock.mockResolvedValue(null);
    const response = await POST(request({ recipient: RECIPIENT }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "signed-out" });
    expect(createSendIntentMock).not.toHaveBeenCalled();
  });

  it("refuses a signed-in viewer with no smart account without signing them out", async () => {
    getViewerMock.mockResolvedValue({ userId: "user-1", smartAccountAddress: null });
    const response = await POST(request({ recipient: RECIPIENT }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "A canonical smart account is required" });
  });
});
