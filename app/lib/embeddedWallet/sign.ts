"use client";

import { executeSwap, getSwapPrice, getUserOperation } from "@coinbase/cdp-core";
import { useCurrentUser, useGetSwapPrice, useSendUserOperation } from "@coinbase/cdp-hooks";
import { useCallback } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { walletFreeGasEnabled } from "./config";
import { assertSendCalls, buildPermit2Approval, executionSlippageBps, isSponsoredSend } from "./intents";
import { NATIVE_ETH, PERMIT2, SWAP_SLIPPAGE_BPS, USDC_BASE } from "./tokens";
import { claimIntent, rememberPendingBroadcast, reportBroadcast, type ClientIntent } from "./client";

type Address = `0x${string}`;
type Hex = `0x${string}`;

const POLL_MS = 1_500;
const APPROVAL_TIMEOUT_MS = 90_000;
/** CDP's quote can lag the chain by a block or two after the approval lands. */
const ALLOWANCE_SYNC_MS = 15_000;
/** Less room than this above the confirmed minimum would likely revert on-chain, so it's refused unsigned. */
const MIN_EXECUTION_SLIPPAGE_BPS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thrown from the claim onward: the intent can't be submitted again, so the UI
 * starts over instead of retrying. `mayHaveSubmitted` is false when the claim
 * was refused or its row failed a check (nothing signed), true once the
 * signing call was made (it may have reached CDP).
 */
export class ClaimedIntentError extends Error {
  constructor(readonly cause: unknown, readonly mayHaveSubmitted: boolean) {
    super(cause instanceof Error ? cause.message : String(cause ?? "unknown error"));
    this.name = "ClaimedIntentError";
  }
}

/** Claims the intent and checks the server's row; nothing is signed yet, so any failure says so. */
async function claimChecked(id: string, check: (intent: ClientIntent) => void) {
  try {
    const { intent } = await claimIntent(id);
    check(intent);
    return intent;
  } catch (cause) {
    throw new ClaimedIntentError(cause, false);
  }
}

/**
 * Rechecks the browser's CDP identity against the validated application
 * session and returns the one canonical smart account to act from.
 */
function useVerifiedSmartAccount() {
  const { currentUser } = useCurrentUser();
  const { user, signOut } = useAppAuth();

  return useCallback(async () => {
    if (!user?.smartAccountAddress || user.walletChainId !== 8453 || !currentUser) {
      throw new Error("The signed-in wallet session is unavailable.");
    }
    if (currentUser.userId !== user.userId) {
      await signOut();
      throw new Error("The wallet identity changed. Sign in again.");
    }
    const providerAccount = currentUser.evmSmartAccounts?.find(
      (address) => address.toLowerCase() === user.smartAccountAddress?.toLowerCase(),
    );
    if (!providerAccount || currentUser.evmSmartAccounts?.length !== 1) {
      await signOut();
      throw new Error("The canonical smart account did not match the browser session.");
    }
    return providerAccount as Address;
  }, [currentUser, signOut, user]);
}

/**
 * The operation is already on its way once CDP returns a hash, so a failed
 * report must not surface as a failed send (the user would resend it). If
 * every attempt fails, the hash is kept for the next reconcile to re-report.
 */
async function reportBroadcastSafely(intentId: string, userOperationHash: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(1_000 * attempt);
    try {
      await reportBroadcast(intentId, userOperationHash);
      return;
    } catch (cause) {
      console.error("reportBroadcast failed", cause);
    }
  }
  rememberPendingBroadcast(intentId, userOperationHash);
}

/**
 * The only application module allowed to call a CDP signing/sending hook.
 * It rechecks the browser identity against the validated application session
 * and decodes the final calls immediately before invoking CDP.
 */
export function useSubmitTypedIntent() {
  const verifiedAccount = useVerifiedSmartAccount();
  const { sendUserOperation } = useSendUserOperation();

  return useCallback(async (confirmed: ClientIntent) => {
    const providerAccount = await verifiedAccount();
    const intent = await claimChecked(confirmed.id, (claimed) => {
      if (
        claimed.kind !== "send"
        || claimed.chainId !== 8453
        || claimed.smartAccountAddress !== providerAccount.toLowerCase()
      ) {
        throw new Error("The prepared operation did not match this wallet.");
      }
      assertSendCalls({
        tokenAddress: claimed.tokenIn,
        recipient: claimed.recipient,
        rawAmount: BigInt(claimed.inputAmount),
        calls: claimed.calls,
      });
    });
    let userOperationHash: string;
    try {
      ({ userOperationHash } = await sendUserOperation({
        evmSmartAccount: providerAccount,
        network: "base",
        calls: intent.calls.map((call) => ({
          to: call.to as Address,
          value: BigInt(call.value),
          data: call.data as Hex,
        })),
        // Free gas: CDP's Paymaster sponsors it. Otherwise gas is paid in USDC
        // through CDP's ERC-20 paymaster (approved in the first call).
        useCdpPaymaster: true,
        ...(isSponsoredSend(intent.calls) ? {} : { paymasterContext: { erc20: USDC_BASE } }),
        idempotencyKey: intent.id,
      }));
    } catch (cause) {
      throw new ClaimedIntentError(cause, true);
    }
    await reportBroadcastSafely(intent.id, userOperationHash);
    return userOperationHash;
  }, [sendUserOperation, verifiedAccount]);
}

/** Polls a user operation until it lands; any other terminal state throws. */
async function waitForInclusion(account: Address, userOperationHash: Hex) {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  for (;;) {
    const operation = await getUserOperation({ evmSmartAccount: account, network: "base", userOperationHash });
    if (operation.status === "complete") return;
    if (operation.status === "failed" || operation.status === "dropped") {
      throw new Error(`The token approval ${operation.status}. Nothing was swapped.`);
    }
    if (Date.now() > deadline) throw new Error("The token approval is taking too long. Nothing was swapped; try again in a minute.");
    await sleep(POLL_MS);
  }
}

/**
 * Submits a confirmed swap intent through CDP's swap API, which quotes,
 * signs Permit2, simulates, and submits on Coinbase's side. Gas for the swap
 * and for the approval it may need is paid in ETH from the account itself, or
 * sponsored by CDP's Paymaster when free gas is on. Everything that can fail before signing (route, balance,
 * approval, the confirmed minimum output) runs before the intent is claimed,
 * so those failures leave it retryable and don't reserve the daily cap.
 * executeSwap takes a slippage, not a floor, so the slippage is sized from a
 * fresh quote to keep CDP's minimum at or above the confirmed one. CDP
 * re-quotes inside executeSwap, so that holds up to one request's drift.
 */
export function useSubmitSwapIntent() {
  const verifiedAccount = useVerifiedSmartAccount();
  const { sendUserOperation } = useSendUserOperation();

  return useCallback(async (confirmed: ClientIntent, onStep?: (step: "approving" | "swapping") => void) => {
    const providerAccount = await verifiedAccount();
    const account = providerAccount.toLowerCase();
    if (
      confirmed.kind !== "swap"
      || confirmed.chainId !== 8453
      || !confirmed.tokenOut
      || !confirmed.minimumOutputAmount
      || confirmed.calls.length !== 0
      || confirmed.smartAccountAddress !== account
      || confirmed.recipient !== account
    ) {
      throw new Error("The prepared operation did not match this wallet.");
    }
    const minimumOutput = BigInt(confirmed.minimumOutputAmount);
    const freeGas = walletFreeGasEnabled();
    const swapParams = {
      network: "base" as const,
      fromToken: confirmed.tokenIn as Address,
      toToken: confirmed.tokenOut as Address,
      fromAmount: confirmed.inputAmount,
      slippageBps: SWAP_SLIPPAGE_BPS,
      account: providerAccount,
    };

    const preflight = async () => {
      const price = await getSwapPrice(swapParams);
      if (!price.liquidityAvailable) throw new Error("No swap route is available for this pair right now.");
      if (price.issues?.balance) throw new Error("Not enough balance for this swap.");
      const allowance = price.issues?.allowance ?? null;
      if (allowance && (confirmed.tokenIn === NATIVE_ETH || allowance.spender.toLowerCase() !== PERMIT2)) {
        throw new Error("The swap asked for an unexpected token spender.");
      }
      return { toAmount: BigInt(price.toAmount), needsApproval: allowance !== null };
    };

    let quote = await preflight();
    if (quote.needsApproval) {
      onStep?.("approving");
      const approval = buildPermit2Approval(confirmed.tokenIn, BigInt(confirmed.inputAmount));
      // Self-paid in ETH unless free gas. No idempotency key: repeating an exact approval leaves the same allowance.
      const { userOperationHash } = await sendUserOperation({
        evmSmartAccount: providerAccount,
        network: "base",
        calls: [{ to: approval.to as Address, value: 0n, data: approval.data as Hex }],
        useCdpPaymaster: freeGas,
      });
      await waitForInclusion(providerAccount, userOperationHash);
      const deadline = Date.now() + ALLOWANCE_SYNC_MS;
      while ((quote = await preflight()).needsApproval) {
        if (Date.now() > deadline) throw new Error("The approval landed but the swap can't see it yet. Try again in a moment.");
        await sleep(POLL_MS);
      }
    }
    const slippageBps = executionSlippageBps(quote.toAmount, minimumOutput, SWAP_SLIPPAGE_BPS);
    if (slippageBps < MIN_EXECUTION_SLIPPAGE_BPS) {
      throw new Error("The price moved below the minimum you confirmed. Nothing was swapped; go back for a new quote.");
    }

    onStep?.("swapping");
    const intent = await claimChecked(confirmed.id, (claimed) => {
      if (
        claimed.kind !== "swap"
        || claimed.smartAccountAddress !== account
        || claimed.recipient !== account
        || claimed.tokenIn !== confirmed.tokenIn
        || claimed.tokenOut !== confirmed.tokenOut
        || claimed.inputAmount !== confirmed.inputAmount
        || claimed.minimumOutputAmount !== confirmed.minimumOutputAmount
        || claimed.calls.length !== 0
      ) {
        throw new Error("The prepared operation did not match this wallet.");
      }
    });
    let userOperationHash: string;
    try {
      const result = await executeSwap({ ...swapParams, slippageBps, useCdpPaymaster: freeGas, idempotencyKey: intent.id });
      if (result.type !== "evm-smart") throw new Error("The swap ran from an unexpected account type.");
      userOperationHash = result.userOpHash;
    } catch (cause) {
      throw new ClaimedIntentError(cause, true);
    }
    await reportBroadcastSafely(intent.id, userOperationHash);
    return userOperationHash;
  }, [sendUserOperation, verifiedAccount]);
}

/** Live, non-binding CDP quote for the review screen; read-only, kept here with the other CDP calls. */
export function useSwapQuote(params: { fromToken: string; toToken: string; fromAmount: string; account: string } | null) {
  return useGetSwapPrice({
    network: "base",
    fromToken: params?.fromToken as Address | undefined,
    toToken: params?.toToken as Address | undefined,
    fromAmount: params?.fromAmount,
    account: params?.account as Address | undefined,
    slippageBps: SWAP_SLIPPAGE_BPS,
    enabled: params !== null,
  });
}
