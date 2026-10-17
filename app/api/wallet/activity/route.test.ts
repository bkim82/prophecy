import { beforeEach, describe, expect, it, vi } from "vitest";

const { allowWalletReadMock, getViewerMock, getWalletActivityMock, listTransactionIntentsMock } = vi.hoisted(() => ({
  allowWalletReadMock: vi.fn(),
  getViewerMock: vi.fn(),
  getWalletActivityMock: vi.fn(),
  listTransactionIntentsMock: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: getViewerMock }));
vi.mock("@/lib/alchemy", () => ({ getWalletActivity: getWalletActivityMock }));
vi.mock("@/lib/transactionIntents", () => ({ listTransactionIntents: listTransactionIntentsMock }));
vi.mock("../readLimit", () => ({ allowWalletRead: allowWalletReadMock, walletReadLimited: vi.fn() }));

import { GET } from "@/app/api/wallet/activity/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const intent = (overrides: Record<string, unknown>) => ({
  id: "intent_1",
  kind: "send",
  tokenIn: USDC,
  tokenOut: null,
  recipient: RECIPIENT,
  inputAmount: "1500000",
  status: "submitted",
  userOperationHash: "0xuserop",
  transactionHash: null,
  failureCode: null,
  createdAt: new Date(2_000),
  ...overrides,
});

const request = (address = ACCOUNT) => new Request(`http://localhost/api/wallet/activity?address=${address}`);

describe("GET /api/wallet/activity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    allowWalletReadMock.mockResolvedValue(true);
    getWalletActivityMock.mockResolvedValue([
      { hash: "0xchain", kind: "received", asset: "ETH", value: 0.5, toAsset: null, toValue: null, timestamp: 1_000 },
    ]);
  });

  it("returns only public activity when the address is not the viewer's canonical account", async () => {
    getViewerMock.mockResolvedValue({ userId: "user_1", smartAccountAddress: RECIPIENT });

    const body = await (await GET(request())).json();

    expect(body.activity).toHaveLength(1);
    expect(listTransactionIntentsMock).not.toHaveBeenCalled();
  });

  it("merges local intents with token symbol and display amount, skipping unconfirmed ones", async () => {
    getViewerMock.mockResolvedValue({ userId: "user_1", smartAccountAddress: ACCOUNT });
    listTransactionIntentsMock.mockResolvedValue([
      intent({}),
      intent({ id: "intent_created", status: "created", userOperationHash: null }),
    ]);

    const body = await (await GET(request())).json();

    expect(body.activity.map((entry: { hash: string }) => entry.hash)).toEqual(["0xuserop", "0xchain"]);
    expect(body.activity[0]).toMatchObject({
      kind: "sent",
      asset: "USDC",
      value: 1.5,
      rawAmount: "1500000",
      status: "submitted",
      recipient: RECIPIENT,
      transactionHash: null,
      local: true,
    });
  });

  it("drops a local intent once Alchemy has indexed its transaction hash", async () => {
    getViewerMock.mockResolvedValue({ userId: "user_1", smartAccountAddress: ACCOUNT });
    listTransactionIntentsMock.mockResolvedValue([intent({ status: "included", transactionHash: "0xchain" })]);

    const body = await (await GET(request())).json();

    expect(body.activity).toHaveLength(1);
    expect(body.activity[0].local).toBeUndefined();
  });
});
