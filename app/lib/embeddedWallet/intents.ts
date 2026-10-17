import { NATIVE_ETH, curatedToken } from "./tokens";

export const BASE_CHAIN_ID = 8453 as const;
export const INTENT_SCHEMA_VERSION = 1 as const;
export const ERC20_TRANSFER_SELECTOR = "a9059cbb";

export type NormalizedCall = { to: string; value: string; data: string };
export type SendIntentInput = {
  idempotencyKey: string;
  tokenAddress: string;
  recipient: string;
  amount: string;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export class IntentValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "IntentValidationError";
  }
}

export function normalizeAddress(value: string) {
  if (!ADDRESS_RE.test(value)) {
    throw new IntentValidationError("invalid-address", "Enter a valid 20-byte address.");
  }
  return value.toLowerCase();
}

export function parseUnits(value: string, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new IntentValidationError("invalid-decimals", "Unsupported token decimals.");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new IntentValidationError("invalid-amount", "Enter a positive decimal amount.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new IntentValidationError("amount-precision", `Use no more than ${decimals} decimal places.`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new IntentValidationError("invalid-amount", "Amount must be greater than zero.");
  return raw;
}

export function formatUnits(raw: bigint, decimals: number) {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function uint256Hex(value: bigint) {
  if (value < 0n || value >= 1n << 256n) {
    throw new IntentValidationError("amount-range", "Amount is outside the uint256 range.");
  }
  return value.toString(16).padStart(64, "0");
}

export function encodeErc20Transfer(recipient: string, rawAmount: bigint) {
  const address = normalizeAddress(recipient);
  return `0x${ERC20_TRANSFER_SELECTOR}${address.slice(2).padStart(64, "0")}${uint256Hex(rawAmount)}`;
}

export function decodeErc20Transfer(data: string) {
  const normalized = data.toLowerCase();
  if (!new RegExp(`^0x${ERC20_TRANSFER_SELECTOR}[0-9a-f]{128}$`).test(normalized)) {
    throw new IntentValidationError("unknown-calldata", "The ERC-20 transfer calldata is invalid.");
  }
  const recipient = normalizeAddress(`0x${normalized.slice(34, 74)}`);
  const amount = BigInt(`0x${normalized.slice(74)}`);
  return { recipient, amount };
}

export function buildSendIntent(
  input: SendIntentInput,
  smartAccountAddress: string,
) {
  if (!IDEMPOTENCY_RE.test(input.idempotencyKey)) {
    throw new IntentValidationError("invalid-idempotency-key", "The operation id is invalid.");
  }
  const account = normalizeAddress(smartAccountAddress);
  const recipient = normalizeAddress(input.recipient);
  if (recipient === "0x0000000000000000000000000000000000000000" || recipient === account) {
    throw new IntentValidationError("blocked-recipient", "Choose a different non-zero recipient.");
  }
  const token = curatedToken(normalizeAddress(input.tokenAddress));
  if (!token) throw new IntentValidationError("unsupported-token", "This token is not enabled for sends.");
  const rawAmount = parseUnits(input.amount, token.decimals);
  if (rawAmount > token.maxSendRaw) {
    throw new IntentValidationError("transaction-limit", `The maximum send is ${formatUnits(token.maxSendRaw, token.decimals)} ${token.symbol}.`);
  }
  const calls: NormalizedCall[] = token.address === NATIVE_ETH
    ? [{ to: recipient, value: rawAmount.toString(), data: "0x" }]
    : [{ to: token.address, value: "0", data: encodeErc20Transfer(recipient, rawAmount) }];
  assertSendCalls({ tokenAddress: token.address, recipient, rawAmount, calls });
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    kind: "send" as const,
    chainId: BASE_CHAIN_ID,
    smartAccountAddress: account,
    token,
    recipient,
    rawAmount,
    calls,
  };
}

export function assertSendCalls(input: {
  tokenAddress: string;
  recipient: string;
  rawAmount: bigint;
  calls: NormalizedCall[];
}) {
  if (input.calls.length !== 1) {
    throw new IntentValidationError("unexpected-batch", "Send requires exactly one call.");
  }
  const [call] = input.calls;
  const to = normalizeAddress(call.to);
  if (input.tokenAddress === NATIVE_ETH) {
    if (to !== input.recipient || call.data !== "0x" || BigInt(call.value) !== input.rawAmount) {
      throw new IntentValidationError("call-mismatch", "The native transfer does not match the intent.");
    }
    return;
  }
  const decoded = decodeErc20Transfer(call.data);
  if (
    to !== input.tokenAddress
    || BigInt(call.value) !== 0n
    || decoded.recipient !== input.recipient
    || decoded.amount !== input.rawAmount
  ) {
    throw new IntentValidationError("call-mismatch", "The token transfer does not match the intent.");
  }
}
