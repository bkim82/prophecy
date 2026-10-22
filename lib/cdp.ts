import "server-only";

import { CdpClient } from "@coinbase/cdp-sdk";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

export type CdpEndUserIdentity = {
  userId: string;
  createdAt: string;
  evmAccountObjects: Array<{
    address: string;
    createdAt: string;
  }>;
  evmSmartAccountObjects: Array<{
    address: string;
    ownerAddresses: string[];
    createdAt: string;
  }>;
};

export class CdpConfigurationError extends Error {
  constructor() {
    super("CDP server credentials are not configured");
    this.name = "CdpConfigurationError";
  }
}

let client: CdpClient | null = null;

function cdpCredentials() {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new CdpConfigurationError();
  return { apiKeyId, apiKeySecret };
}

function getCdpClient() {
  if (client) return client;
  client = new CdpClient(cdpCredentials());
  return client;
}

export class CdpOnrampError extends Error {
  constructor(readonly status: number) {
    super(`CDP Onramp session request failed (${status})`);
    this.name = "CdpOnrampError";
  }
}

const CDP_HOST = "api.cdp.coinbase.com";
const ONRAMP_SESSION_PATH = "/platform/v2/onramp/sessions";
const ONRAMP_URL_PREFIX = "https://pay.coinbase.com/";

/**
 * Creates a single-use Coinbase-hosted Onramp URL. CdpClient doesn't expose
 * Onramp, so this calls the REST endpoint with an SDK-signed JWT. The caller
 * supplies the destination; never pass a client-chosen address or network.
 */
export async function createCdpOnrampSession(input: {
  destinationAddress: string;
  purchaseCurrency: string;
  destinationNetwork: string;
  paymentCurrency: string;
  paymentAmount?: string;
  redirectUrl: string;
  clientIp?: string;
  partnerUserRef: string;
}): Promise<string> {
  const jwt = await generateJwt({
    ...cdpCredentials(),
    requestMethod: "POST",
    requestHost: CDP_HOST,
    requestPath: ONRAMP_SESSION_PATH,
  });
  const response = await fetch(`https://${CDP_HOST}${ONRAMP_SESSION_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new CdpOnrampError(response.status);
  const body = await response.json() as { session?: { onrampUrl?: unknown } };
  const url = body.session?.onrampUrl;
  if (typeof url !== "string" || !url.startsWith(ONRAMP_URL_PREFIX)) throw new CdpOnrampError(502);
  return url;
}

/** Validates a browser access token without retaining it or provider actions. */
export async function validateCdpAccessToken(accessToken: string): Promise<CdpEndUserIdentity> {
  const endUser = await getCdpClient().endUser.validateAccessToken({ accessToken });
  return {
    userId: endUser.userId,
    createdAt: endUser.createdAt,
    evmAccountObjects: endUser.evmAccountObjects.map(({ address, createdAt }) => ({
      address,
      createdAt,
    })),
    evmSmartAccountObjects: endUser.evmSmartAccountObjects.map(
      ({ address, ownerAddresses, createdAt }) => ({
        address,
        ownerAddresses: [...ownerAddresses],
        createdAt,
      }),
    ),
  };
}

export async function getCdpUserOperation(
  smartAccountAddress: string,
  userOperationHash: string,
) {
  const operation = await getCdpClient().evm.getUserOperation({
    smartAccount: smartAccountAddress as `0x${string}`,
    userOpHash: userOperationHash as `0x${string}`,
  });
  return {
    status: operation.status as string,
    transactionHash: operation.transactionHash ?? null,
    calls: operation.calls.map((call) => ({
      to: call.to.toLowerCase(),
      value: (call.value ?? 0n).toString(),
      data: call.data ?? "0x",
    })),
  };
}
