import { describe, expect, it } from "vitest";
import {
  IntentValidationError,
  assertSendCalls,
  buildSendIntent,
  decodeErc20Transfer,
  encodeErc20Transfer,
  formatUnits,
  normalizeAddress,
  parseUnits,
} from "./intents";
import { NATIVE_ETH } from "./tokens";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("raw unit conversion", () => {
  it("parses and formats without floating point", () => {
    expect(parseUnits("1.000001", 6)).toBe(1_000_001n);
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
    expect(formatUnits(1_000_001n, 6)).toBe("1.000001");
  });

  it("rejects excess precision and non-canonical decimal forms", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(IntentValidationError);
    expect(() => parseUnits("1e3", 18)).toThrow(IntentValidationError);
    expect(() => parseUnits("-1", 18)).toThrow(IntentValidationError);
  });
});

describe("send intent", () => {
  it("normalizes a native transfer into one immutable call", () => {
    const intent = buildSendIntent({
      idempotencyKey: "operation_123456789",
      tokenAddress: NATIVE_ETH,
      recipient: RECIPIENT.toUpperCase().replace("0X", "0x"),
      amount: "0.01",
    }, ACCOUNT);
    expect(intent.rawAmount).toBe(10_000_000_000_000_000n);
    expect(intent.calls).toEqual([{
      to: RECIPIENT,
      value: "10000000000000000",
      data: "0x",
    }]);
  });

  it("round-trips and independently validates ERC-20 transfer calldata", () => {
    const data = encodeErc20Transfer(RECIPIENT, 12_345_678n);
    expect(decodeErc20Transfer(data)).toEqual({ recipient: RECIPIENT, amount: 12_345_678n });
    expect(() => assertSendCalls({
      tokenAddress: USDC,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [{ to: USDC, value: "0", data }],
    })).toThrowError(/does not match/);
  });

  it("rejects batches, self sends, unknown tokens, and over-limit sends", () => {
    expect(() => assertSendCalls({
      tokenAddress: NATIVE_ETH,
      recipient: RECIPIENT,
      rawAmount: 1n,
      calls: [
        { to: RECIPIENT, value: "1", data: "0x" },
        { to: RECIPIENT, value: "1", data: "0x" },
      ],
    })).toThrowError(/exactly one/);
    expect(() => buildSendIntent({
      idempotencyKey: "operation_123456789",
      tokenAddress: NATIVE_ETH,
      recipient: ACCOUNT,
      amount: "0.01",
    }, ACCOUNT)).toThrowError(/different/);
    expect(() => buildSendIntent({
      idempotencyKey: "operation_123456789",
      tokenAddress: "0x3333333333333333333333333333333333333333",
      recipient: RECIPIENT,
      amount: "1",
    }, ACCOUNT)).toThrowError(/not enabled/);
    expect(() => buildSendIntent({
      idempotencyKey: "operation_123456789",
      tokenAddress: USDC,
      recipient: RECIPIENT,
      amount: "100.000001",
    }, ACCOUNT)).toThrowError(/maximum/);
  });

  it("requires exact 20-byte addresses", () => {
    expect(normalizeAddress(RECIPIENT.toUpperCase().replace("0X", "0x"))).toBe(RECIPIENT);
    expect(() => normalizeAddress("0x1234")).toThrow(IntentValidationError);
  });
});
