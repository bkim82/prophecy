import { describe, expect, it } from "vitest";
import {
  IntentValidationError,
  assertSendCalls,
  assertSwapOperationCalls,
  buildPermit2Approval,
  buildSendIntent,
  buildSwapIntent,
  decodeErc20Approve,
  decodeErc20Transfer,
  encodeErc20Approve,
  encodeErc20Transfer,
  executionSlippageBps,
  formatUnits,
  isSponsoredSend,
  normalizeAddress,
  normalizeAmount,
  parseUnits,
} from "./intents";
import { CDP_ERC20_PAYMASTER, GAS_ALLOWANCE_RAW, NATIVE_ETH, PERMIT2, curatedToken } from "./tokens";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("raw unit conversion", () => {
  it("parses and formats without floating point", () => {
    expect(parseUnits("1.000001", 6)).toBe(1_000_001n);
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
    expect(formatUnits(1_000_001n, 6)).toBe("1.000001");
  });

  it("canonicalizes loosely typed amounts but leaves commas to be rejected", () => {
    expect(normalizeAmount(" .5 ")).toBe("0.5");
    expect(normalizeAmount("2.")).toBe("2");
    expect(normalizeAmount("007.10")).toBe("7.10");
    expect(normalizeAmount("0.1")).toBe("0.1");
    expect(() => parseUnits(normalizeAmount("1,000"), 6)).toThrow(IntentValidationError);
  });

  it("rejects excess precision and non-canonical decimal forms", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(IntentValidationError);
    expect(() => parseUnits("1e3", 18)).toThrow(IntentValidationError);
    expect(() => parseUnits("-1", 18)).toThrow(IntentValidationError);
  });
});

describe("send intent", () => {
  const usdc = curatedToken(USDC)!;
  const eth = curatedToken(NATIVE_ETH)!;
  const OTHER = "0x4444444444444444444444444444444444444444";
  const other = { address: OTHER, symbol: "OTH", decimals: 18, maxSendRaw: null, maxDailyRaw: null };
  const gasApproval = { to: USDC, value: "0", data: encodeErc20Approve(CDP_ERC20_PAYMASTER, GAS_ALLOWANCE_RAW) };
  const send = (tokenAddress: string, amount: string, recipient = RECIPIENT) => ({
    idempotencyKey: "operation_123456789",
    tokenAddress,
    recipient,
    amount,
  });

  it("batches a fixed USDC gas approval for the paymaster before a USDC transfer", () => {
    const intent = buildSendIntent(send(USDC, "1.5", RECIPIENT.toUpperCase().replace("0X", "0x")), ACCOUNT, usdc);
    expect(intent.rawAmount).toBe(1_500_000n);
    expect(intent.calls).toEqual([gasApproval, { to: USDC, value: "0", data: encodeErc20Transfer(RECIPIENT, 1_500_000n) }]);
    expect(decodeErc20Approve(intent.calls[0].data)).toEqual({ spender: CDP_ERC20_PAYMASTER, amount: GAS_ALLOWANCE_RAW });
  });

  it("pays USDC gas for native ETH and arbitrary ERC-20 sends", () => {
    expect(buildSendIntent(send(NATIVE_ETH, "0.01"), ACCOUNT, eth).calls).toEqual([
      gasApproval,
      { to: RECIPIENT, value: "10000000000000000", data: "0x" },
    ]);
    expect(buildSendIntent(send(OTHER, "1000000"), ACCOUNT, other).calls).toEqual([
      gasApproval,
      { to: OTHER, value: "0", data: encodeErc20Transfer(RECIPIENT, 10n ** 24n) },
    ]);
  });

  it("drops the gas approval when free gas is sponsored, and still validates the lone transfer", () => {
    const transfer = { to: USDC, value: "0", data: encodeErc20Transfer(RECIPIENT, 1_500_000n) };
    const intent = buildSendIntent(send(USDC, "1.5"), ACCOUNT, usdc, true);
    expect(intent.calls).toEqual([transfer]);
    expect(isSponsoredSend(intent.calls)).toBe(true);
    expect(isSponsoredSend(buildSendIntent(send(USDC, "1.5"), ACCOUNT, usdc).calls)).toBe(false);
    expect(buildSendIntent(send(NATIVE_ETH, "0.01"), ACCOUNT, eth, true).calls).toEqual([
      { to: RECIPIENT, value: "10000000000000000", data: "0x" },
    ]);
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [transfer],
    })).toThrowError(/does not match/);
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 1_500_000n,
      calls: [gasApproval],
    })).toThrowError(/calldata is invalid/);
  });

  it("round-trips and independently validates calldata", () => {
    const data = encodeErc20Transfer(RECIPIENT, 12_345_678n);
    expect(decodeErc20Transfer(data)).toEqual({ recipient: RECIPIENT, amount: 12_345_678n });
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [gasApproval, { to: USDC, value: "0", data }],
    })).toThrowError(/does not match/);
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 12_345_678n,
      calls: [{ ...gasApproval, data: encodeErc20Approve(RECIPIENT, GAS_ALLOWANCE_RAW) }, { to: USDC, value: "0", data }],
    })).toThrowError(/gas approval/);
    expect(() => assertSendCalls({
      tokenAddress: OTHER,
      recipient: RECIPIENT,
      rawAmount: 12_345_678n,
      calls: [{ ...gasApproval, to: OTHER }, { to: OTHER, value: "0", data }],
    })).toThrowError(/gas approval/);
    expect(() => assertSendCalls({
      tokenAddress: NATIVE_ETH,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [gasApproval, { to: RECIPIENT, value: "2", data: "0x" }],
    })).toThrowError(/native transfer/);
  });

  it("rejects unexpected batches, mismatched tokens, self sends, and over-limit sends", () => {
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [gasApproval, gasApproval, { to: USDC, value: "0", data: encodeErc20Transfer(RECIPIENT, 1n) }],
    })).toThrowError(/optionally after one gas approval/);
    expect(() => assertSendCalls({ tokenAddress: USDC, recipient: RECIPIENT, rawAmount: 1n, calls: [] }))
      .toThrowError(/optionally after one gas approval/);
    expect(() => buildSendIntent(send(OTHER, "1"), ACCOUNT, usdc)).toThrowError(/not enabled/);
    expect(() => buildSendIntent(send(USDC, "1", ACCOUNT), ACCOUNT, usdc)).toThrowError(/different/);
    expect(() => buildSendIntent(send(USDC, "100.000001"), ACCOUNT, usdc)).toThrowError(/maximum/);
  });

  it("requires exact 20-byte addresses", () => {
    expect(normalizeAddress(RECIPIENT.toUpperCase().replace("0X", "0x"))).toBe(RECIPIENT);
    expect(() => normalizeAddress("0x1234")).toThrow(IntentValidationError);
  });
});

describe("swap intents", () => {
  const usdc = curatedToken(USDC)!;
  const MEME = "0x5555555555555555555555555555555555555555";
  const meme = { address: MEME, symbol: "MEME", decimals: 18, maxSendRaw: null, maxDailyRaw: null };
  const swap = (fromToken: string, toToken: string, amount: string) => ({
    idempotencyKey: "swap-intent-0001",
    fromToken,
    toToken,
    amount,
  });

  it("builds an exact-input swap to the account itself with no stored calls", () => {
    const intent = buildSwapIntent(swap(USDC, MEME, "25.5"), ACCOUNT, usdc, meme);
    expect(intent.kind).toBe("swap");
    expect(intent.rawAmount).toBe(25_500_000n);
    expect(intent.recipient).toBe(ACCOUNT);
    expect(intent.calls).toEqual([]);
  });

  it("rejects same-token, mismatched-token, and over-limit swaps", () => {
    expect(() => buildSwapIntent(swap(USDC, USDC, "1"), ACCOUNT, usdc, usdc)).toThrowError(/different/);
    expect(() => buildSwapIntent(swap(MEME, USDC, "1"), ACCOUNT, usdc, meme)).toThrowError(/not enabled/);
    expect(() => buildSwapIntent(swap(USDC, MEME, "100.000001"), ACCOUNT, usdc, meme)).toThrowError(/maximum/);
  });

  it("bounds a reported swap operation's value and sold-token calls", () => {
    const ROUTER = "0x6666666666666666666666666666666666666666";
    const routerCall = (value = "0") => ({ to: ROUTER, value, data: "0x1fff991f" });
    const check = (tokenIn: string, calls: { to: string; value: string; data: string }[]) =>
      () => assertSwapOperationCalls({ tokenIn, rawAmount: 25_500_000n, calls });

    expect(check(USDC, [routerCall()])).not.toThrow();
    expect(check(USDC, [buildPermit2Approval(USDC, 25_500_000n), routerCall()])).not.toThrow();
    expect(check(NATIVE_ETH, [routerCall("25500000")])).not.toThrow();
    expect(check(USDC, [])).toThrowError(/no calls/);
    expect(check(USDC, [routerCall("1")])).toThrowError(/more ETH/);
    expect(check(NATIVE_ETH, [routerCall("25500001")])).toThrowError(/more ETH/);
    expect(check(USDC, [{ to: USDC, value: "0", data: encodeErc20Transfer(RECIPIENT, 1n) }])).toThrowError(/transfers/);
    expect(check(USDC, [{ to: USDC, value: "0", data: encodeErc20Approve(RECIPIENT, 1n) }])).toThrowError(/spender/);
    expect(check(USDC, [buildPermit2Approval(USDC, 25_500_001n), routerCall()])).toThrowError(/spender/);
  });

  it("approves exactly the swapped amount to Permit2 and never native ETH", () => {
    const approval = buildPermit2Approval(USDC, 25_500_000n);
    expect(approval.to).toBe(USDC);
    expect(decodeErc20Approve(approval.data)).toEqual({ spender: PERMIT2, amount: 25_500_000n });
    expect(() => buildPermit2Approval(NATIVE_ETH, 1n)).toThrowError(/no approval/);
  });
});

describe("executionSlippageBps", () => {
  it("keeps the fresh quote's minimum at or above the confirmed one", () => {
    // Reviewed at 1000 with 1% slippage → confirmed minimum 990; the quote then ticks down to 998.
    const bps = executionSlippageBps(998n, 990n, 100);
    expect(bps).toBe(80);
    expect((998n * BigInt(10_000 - bps)) / 10_000n >= 990n).toBe(true);
  });

  it("caps at the configured maximum when the price rose", () => {
    expect(executionSlippageBps(2_000n, 990n, 100)).toBe(100);
  });

  it("returns -1 once the quote is at or below the minimum", () => {
    expect(executionSlippageBps(990n, 990n, 100)).toBe(-1);
    expect(executionSlippageBps(900n, 990n, 100)).toBe(-1);
  });
});
