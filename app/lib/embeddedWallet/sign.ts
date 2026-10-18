"use client";

import { useCurrentUser, useSendUserOperation } from "@coinbase/cdp-hooks";
import { useCallback } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { assertSendCalls } from "./intents";
import { USDC_BASE } from "./tokens";
import { claimIntent, reportBroadcast } from "./client";

/**
 * The only application module allowed to call a CDP signing/sending hook.
 * It rechecks the browser identity against the validated application session
 * and decodes the final calls immediately before invoking CDP.
 */
export function useSubmitTypedIntent() {
  const { currentUser } = useCurrentUser();
  const { sendUserOperation } = useSendUserOperation();
  const { user, signOut } = useAppAuth();

  return useCallback(async (intentId: string) => {
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

    const { intent } = await claimIntent(intentId);
    if (
      intent.kind !== "send"
      || intent.chainId !== 8453
      || intent.smartAccountAddress !== user.smartAccountAddress.toLowerCase()
    ) {
      throw new Error("The prepared operation did not match this wallet.");
    }
    assertSendCalls({
      tokenAddress: intent.tokenIn,
      recipient: intent.recipient,
      rawAmount: BigInt(intent.inputAmount),
      calls: intent.calls,
    });

    const result = await sendUserOperation({
      evmSmartAccount: providerAccount,
      network: "base",
      calls: intent.calls.map((call) => ({
        to: call.to as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      })),
      // Gas is paid in USDC through CDP's ERC-20 paymaster (approved in the first call).
      useCdpPaymaster: true,
      paymasterContext: { erc20: USDC_BASE },
      idempotencyKey: intent.id,
    });
    await reportBroadcast(intent.id, result.userOperationHash);
    return result.userOperationHash;
  }, [currentUser, sendUserOperation, signOut, user]);
}
