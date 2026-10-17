import { describe, expect, it } from "vitest";
import type { CdpEndUserIdentity } from "@/lib/cdp";
import {
  BASE_CHAIN_ID,
  selectCanonicalEmbeddedWallet,
} from "@/lib/embeddedWalletAccount";

const owner = `0x${"a".repeat(40)}`;
const smartAccount = `0x${"B".repeat(40)}`;

function endUser(overrides: Partial<CdpEndUserIdentity> = {}): CdpEndUserIdentity {
  return {
    userId: "cdp-user-123",
    createdAt: "2026-10-01T00:00:00.000Z",
    evmAccountObjects: [{ address: owner, createdAt: "2026-10-01T00:00:00.000Z" }],
    evmSmartAccountObjects: [{
      address: smartAccount,
      ownerAddresses: [owner.toUpperCase().replace("0X", "0x")],
      createdAt: "2026-10-01T00:00:01.000Z",
    }],
    ...overrides,
  };
}

describe("selectCanonicalEmbeddedWallet", () => {
  it("selects the explicit smart-account object and matching owner", () => {
    expect(selectCanonicalEmbeddedWallet(endUser())).toEqual({
      userId: "cdp-user-123",
      smartAccountAddress: smartAccount.toLowerCase(),
      ownerAddress: owner,
      chainId: BASE_CHAIN_ID,
      createdAt: new Date("2026-10-01T00:00:01.000Z"),
    });
  });

  it.each([
    ["missing-smart-account", []],
    ["multiple-smart-accounts", [
      endUser().evmSmartAccountObjects[0],
      { ...endUser().evmSmartAccountObjects[0], address: `0x${"c".repeat(40)}` },
    ]],
  ] as const)("rejects %s", (code, accounts) => {
    expect(() => selectCanonicalEmbeddedWallet(endUser({
      evmSmartAccountObjects: [...accounts],
    }))).toThrowError(code);
  });

  it("rejects a smart-account owner that is not an explicit EOA object", () => {
    expect(() => selectCanonicalEmbeddedWallet(endUser({ evmAccountObjects: [] })))
      .toThrowError("owner-account-mismatch");
  });

  it("rejects smart accounts with ambiguous owners", () => {
    const current = endUser();
    current.evmSmartAccountObjects[0].ownerAddresses.push(`0x${"d".repeat(40)}`);
    expect(() => selectCanonicalEmbeddedWallet(current)).toThrowError("ambiguous-owner");
  });
});
