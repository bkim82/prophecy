import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { onrampOrders } from "@/db/schema";
import { walletOnrampSandbox } from "@/app/lib/embeddedWallet/config";
import { createCdpOnrampSession } from "@/lib/cdp";
import { auditWalletEvent } from "@/lib/transactionIntents";

/** Whole dollars or cents, no sign/exponent. Coinbase enforces the real min/max per user and region. */
const AMOUNT_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

export function validOnrampAmount(amount: string) {
  return AMOUNT_PATTERN.test(amount) && Number(amount) > 0;
}

/**
 * Card → USDC on Base, delivered only to the viewer's canonical smart account.
 * The hosted URL is single-use and not stored; the row records that a session
 * was opened (status stays `created` until order reconciliation exists).
 */
export async function createUsdcOnrampSession(input: {
  userId: string;
  smartAccountAddress: string;
  paymentAmount?: string;
  redirectUrl: string;
  clientIp?: string;
}) {
  const id = randomUUID();
  const url = await createCdpOnrampSession({
    destinationAddress: input.smartAccountAddress,
    destinationNetwork: "base",
    purchaseCurrency: "USDC",
    paymentCurrency: "USD",
    paymentAmount: input.paymentAmount,
    redirectUrl: input.redirectUrl,
    clientIp: input.clientIp,
    partnerUserRef: walletOnrampSandbox() ? `sandbox-${input.userId}` : input.userId,
  });
  await getDb().insert(onrampOrders).values({
    id,
    userId: input.userId,
    smartAccountAddress: input.smartAccountAddress,
    asset: "USDC",
  });
  await auditWalletEvent("onramp.session_created", input.userId, id, {
    sandbox: walletOnrampSandbox(),
    preset: input.paymentAmount ?? null,
  });
  return { id, url };
}
