import { CDP_ERC20_PAYMASTER, GAS_ALLOWANCE_RAW, NATIVE_ETH, PERMIT2, USDC_BASE, type SendToken } from "./tokens";

export const BASE_CHAIN_ID = 8453 as const;
export const INTENT_SCHEMA_VERSION = 1 as const;
export const ERC20_TRANSFER_SELECTOR = "a9059cbb";
export const ERC20_APPROVE_SELECTOR = "095ea7b3";

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

/**
 * Canonicalizes typed amounts (" .5", "2.", "007") into parseUnits' strict form.
 * Commas are left in (and rejected): "0,5" vs "1,000" is locale-ambiguous.
 */
export function normalizeAmount(value: string) {
  let amount = value.trim();
  if (amount.startsWith(".")) amount = `0${amount}`;
  if (amount.endsWith(".")) amount = amount.slice(0, -1);
  return amount.replace(/^0+(?=\d)/, "");
}

export function parseUnits(value: string, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new IntentValidationError("invalid-decimals", "Unsupported token decimals.");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new IntentValidationError("invalid-amount", "Enter an amount like 0.50 (digits and one dot, no commas).");
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

function encodeAddressAmount(selector: string, address: string, rawAmount: bigint) {
  return `0x${selector}${normalizeAddress(address).slice(2).padStart(64, "0")}${uint256Hex(rawAmount)}`;
}

function decodeAddressAmount(selector: string, data: string) {
  const normalized = data.toLowerCase();
  if (!new RegExp(`^0x${selector}0{24}[0-9a-f]{40}[0-9a-f]{64}$`).test(normalized)) {
    throw new IntentValidationError("unknown-calldata", "The ERC-20 calldata is invalid.");
  }
  return {
    address: normalizeAddress(`0x${normalized.slice(34, 74)}`),
    amount: BigInt(`0x${normalized.slice(74)}`),
  };
}

export function encodeErc20Transfer(recipient: string, rawAmount: bigint) {
  return encodeAddressAmount(ERC20_TRANSFER_SELECTOR, recipient, rawAmount);
}

export function decodeErc20Transfer(data: string) {
  const { address, amount } = decodeAddressAmount(ERC20_TRANSFER_SELECTOR, data);
  return { recipient: address, amount };
}

export function encodeErc20Approve(spender: string, rawAmount: bigint) {
  return encodeAddressAmount(ERC20_APPROVE_SELECTOR, spender, rawAmount);
}

export function decodeErc20Approve(data: string) {
  const { address, amount } = decodeAddressAmount(ERC20_APPROVE_SELECTOR, data);
  return { spender: address, amount };
}

/** Lets CDP's ERC-20 paymaster take the gas fee in USDC; batched first in every USDC-gas user operation. */
export function gasAllowanceCall(): NormalizedCall {
  return { to: USDC_BASE, value: "0", data: encodeErc20Approve(CDP_ERC20_PAYMASTER, GAS_ALLOWANCE_RAW) };
}

/** `token` is resolved server-side (curated or Alchemy metadata), never taken from the client. */
export function buildSendIntent(
  input: SendIntentInput,
  smartAccountAddress: string,
  token: SendToken,
) {
  if (!IDEMPOTENCY_RE.test(input.idempotencyKey)) {
    throw new IntentValidationError("invalid-idempotency-key", "The operation id is invalid.");
  }
  const account = normalizeAddress(smartAccountAddress);
  const recipient = normalizeAddress(input.recipient);
  if (recipient === "0x0000000000000000000000000000000000000000" || recipient === account) {
    throw new IntentValidationError("blocked-recipient", "Choose a different non-zero recipient.");
  }
  if (normalizeAddress(input.tokenAddress) !== token.address) {
    throw new IntentValidationError("unsupported-token", "This token is not enabled for sends.");
  }
  const rawAmount = parseUnits(input.amount, token.decimals);
  if (token.maxSendRaw !== null && rawAmount > token.maxSendRaw) {
    throw new IntentValidationError("transaction-limit", `The maximum send is ${formatUnits(token.maxSendRaw, token.decimals)} ${token.symbol}.`);
  }
  const calls: NormalizedCall[] = [
    gasAllowanceCall(),
    token.address === NATIVE_ETH
      ? { to: recipient, value: rawAmount.toString(), data: "0x" }
      : { to: token.address, value: "0", data: encodeErc20Transfer(recipient, rawAmount) },
  ];
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

export type SwapIntentInput = {
  idempotencyKey: string;
  fromToken: string;
  toToken: string;
  amount: string;
};

/** Raw minimum output the user accepted on review: a positive integer string. */
export function parseMinimumOutput(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,77}$/.test(value)) {
    throw new IntentValidationError("invalid-minimum-output", "The confirmed swap quote is invalid.");
  }
  return value;
}

/**
 * Largest slippage (capped at `maxBps`) that keeps `toAmount × (1 − bps)` at
 * or above the confirmed minimum; -1 when the quote is already at or below it.
 */
export function executionSlippageBps(toAmount: bigint, minimumOutput: bigint, maxBps: number) {
  if (toAmount <= minimumOutput) return -1;
  const room = Number(((toAmount - minimumOutput) * 10_000n) / toAmount);
  return Math.min(room, maxBps);
}

/**
 * Exact-input swap of a held token into any Base token. CDP builds, simulates,
 * and submits the swap calls itself, so the stored batch is empty and the
 * recipient is always the account.
 */
export function buildSwapIntent(
  input: SwapIntentInput,
  smartAccountAddress: string,
  fromToken: SendToken,
  toToken: SendToken,
) {
  if (!IDEMPOTENCY_RE.test(input.idempotencyKey)) {
    throw new IntentValidationError("invalid-idempotency-key", "The operation id is invalid.");
  }
  const account = normalizeAddress(smartAccountAddress);
  if (normalizeAddress(input.fromToken) !== fromToken.address || normalizeAddress(input.toToken) !== toToken.address) {
    throw new IntentValidationError("unsupported-token", "This token is not enabled for swaps.");
  }
  if (fromToken.address === toToken.address) {
    throw new IntentValidationError("same-token", "Pick two different tokens.");
  }
  const rawAmount = parseUnits(input.amount, fromToken.decimals);
  if (fromToken.maxSendRaw !== null && rawAmount > fromToken.maxSendRaw) {
    throw new IntentValidationError("transaction-limit", `The maximum swap is ${formatUnits(fromToken.maxSendRaw, fromToken.decimals)} ${fromToken.symbol}.`);
  }
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    kind: "swap" as const,
    chainId: BASE_CHAIN_ID,
    smartAccountAddress: account,
    fromToken,
    toToken,
    recipient: account,
    rawAmount,
    calls: [] as NormalizedCall[],
  };
}

/**
 * The one approval allowed before a swap: an exact allowance from the sold
 * token to Permit2, sent as its own self-paid (ETH gas) user operation.
 */
export function buildPermit2Approval(tokenAddress: string, rawAmount: bigint): NormalizedCall {
  const token = normalizeAddress(tokenAddress);
  if (token === NATIVE_ETH) {
    throw new IntentValidationError("unexpected-approval", "Native ETH needs no approval.");
  }
  return { to: token, value: "0", data: encodeErc20Approve(PERMIT2, rawAmount) };
}

/**
 * Bounds what a reported swap user operation may do, since CDP builds its
 * calls: native value at most the ETH sold (zero for an ERC-20 sell), and any
 * top-level approve or transfer of the sold token only to Permit2, at most the
 * sold amount. The swap router itself is CDP's choice and is not pinned.
 */
export function assertSwapOperationCalls(input: {
  tokenIn: string;
  rawAmount: bigint;
  calls: NormalizedCall[];
}) {
  const tokenIn = normalizeAddress(input.tokenIn);
  if (input.calls.length === 0) {
    throw new IntentValidationError("unexpected-calls", "The swap operation has no calls.");
  }
  const nativeValue = input.calls.reduce((sum, call) => sum + BigInt(call.value), 0n);
  if (nativeValue > (tokenIn === NATIVE_ETH ? input.rawAmount : 0n)) {
    throw new IntentValidationError("unexpected-value", "The swap operation moves more ETH than was sold.");
  }
  for (const call of input.calls) {
    if (call.to.toLowerCase() !== tokenIn) continue;
    const selector = call.data.slice(2, 10).toLowerCase();
    if (selector === ERC20_TRANSFER_SELECTOR) {
      throw new IntentValidationError("unexpected-transfer", "The swap operation transfers the sold token directly.");
    }
    if (selector === ERC20_APPROVE_SELECTOR) {
      const { spender, amount } = decodeErc20Approve(call.data);
      if (spender !== PERMIT2 || amount > input.rawAmount) {
        throw new IntentValidationError("unexpected-approval", "The swap operation approves an unexpected spender.");
      }
    }
  }
}

export function assertSendCalls(input: {
  tokenAddress: string;
  recipient: string;
  rawAmount: bigint;
  calls: NormalizedCall[];
}) {
  if (input.calls.length !== 2) {
    throw new IntentValidationError("unexpected-batch", "Send requires exactly a gas approval and a transfer.");
  }
  const [approveCall, transferCall] = input.calls;
  const approval = decodeErc20Approve(approveCall.data);
  if (
    normalizeAddress(approveCall.to) !== USDC_BASE
    || BigInt(approveCall.value) !== 0n
    || approval.spender !== CDP_ERC20_PAYMASTER
    || approval.amount !== GAS_ALLOWANCE_RAW
  ) {
    throw new IntentValidationError("call-mismatch", "The gas approval does not match policy.");
  }
  if (input.tokenAddress === NATIVE_ETH) {
    if (
      normalizeAddress(transferCall.to) !== input.recipient
      || transferCall.data !== "0x"
      || BigInt(transferCall.value) !== input.rawAmount
    ) {
      throw new IntentValidationError("call-mismatch", "The native transfer does not match the intent.");
    }
    return;
  }
  const decoded = decodeErc20Transfer(transferCall.data);
  if (
    normalizeAddress(transferCall.to) !== input.tokenAddress
    || BigInt(transferCall.value) !== 0n
    || decoded.recipient !== input.recipient
    || decoded.amount !== input.rawAmount
  ) {
    throw new IntentValidationError("call-mismatch", "The token transfer does not match the intent.");
  }
}
