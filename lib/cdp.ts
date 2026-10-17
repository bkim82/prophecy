import "server-only";

import { CdpClient } from "@coinbase/cdp-sdk";

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

function getCdpClient() {
  if (client) return client;

  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new CdpConfigurationError();

  client = new CdpClient({ apiKeyId, apiKeySecret });
  return client;
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
