import type { CdpEndUserIdentity } from "@/lib/cdp";

export const BASE_CHAIN_ID = 8453 as const;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type CanonicalEmbeddedWallet = {
  userId: string;
  smartAccountAddress: string;
  ownerAddress: string;
  chainId: typeof BASE_CHAIN_ID;
  createdAt: Date;
};

export type AccountSelectionFailure =
  | "invalid-user-id"
  | "missing-smart-account"
  | "multiple-smart-accounts"
  | "invalid-smart-account"
  | "ambiguous-owner"
  | "owner-account-mismatch"
  | "invalid-created-at";

export class AccountSelectionError extends Error {
  constructor(readonly code: AccountSelectionFailure) {
    super(code);
    this.name = "AccountSelectionError";
  }
}

function normalizeAddress(address: string) {
  if (!EVM_ADDRESS.test(address)) throw new AccountSelectionError("invalid-smart-account");
  return address.toLowerCase();
}

/**
 * Selects by the installed SDK's explicit account-object discriminators.
 * CDP does not attach a chain to these objects, so Base remains an application
 * invariant and must stay disabled until the credentialed testnet spike passes.
 */
export function selectCanonicalEmbeddedWallet(
  endUser: CdpEndUserIdentity,
): CanonicalEmbeddedWallet {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(endUser.userId)) {
    throw new AccountSelectionError("invalid-user-id");
  }

  if (endUser.evmSmartAccountObjects.length === 0) {
    throw new AccountSelectionError("missing-smart-account");
  }
  if (endUser.evmSmartAccountObjects.length !== 1) {
    throw new AccountSelectionError("multiple-smart-accounts");
  }

  const smartAccount = endUser.evmSmartAccountObjects[0];
  const smartAccountAddress = normalizeAddress(smartAccount.address);
  if (smartAccount.ownerAddresses.length !== 1) {
    throw new AccountSelectionError("ambiguous-owner");
  }

  const ownerAddress = normalizeAddress(smartAccount.ownerAddresses[0]);
  const matchingOwners = endUser.evmAccountObjects.filter(
    (account) => EVM_ADDRESS.test(account.address) && account.address.toLowerCase() === ownerAddress,
  );
  if (matchingOwners.length !== 1) {
    throw new AccountSelectionError("owner-account-mismatch");
  }

  const createdAt = new Date(smartAccount.createdAt);
  if (!Number.isFinite(createdAt.getTime())) {
    throw new AccountSelectionError("invalid-created-at");
  }

  return {
    userId: endUser.userId,
    smartAccountAddress,
    ownerAddress,
    chainId: BASE_CHAIN_ID,
    createdAt,
  };
}
