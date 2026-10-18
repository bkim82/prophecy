export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

/**
 * CDP's ERC-20 paymaster on Base mainnet: it pays gas in ETH and pulls the fee
 * in USDC from the smart account (https://docs.cdp.coinbase.com/paymaster/guides/erc20-gas-payments).
 */
export const CDP_ERC20_PAYMASTER = "0x2faeb0760d4230ef2ac21496bb4f0b47d634fd4c" as const;

/** USDC allowance re-approved to the paymaster on every send; caps the gas fee it can pull. */
export const GAS_ALLOWANCE_RAW = 1_000_000n;

export type CuratedToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  maxSendRaw: bigint;
  maxDailySponsoredRaw: bigint;
};

// USDC only for now; gas is also paid in USDC.
export const CURATED_BASE_TOKENS = [
  {
    address: USDC_BASE,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    maxSendRaw: 100_000_000n,
    maxDailySponsoredRaw: 250_000_000n,
  },
] as const satisfies readonly CuratedToken[];

export function curatedToken(address: string) {
  const normalized = address.toLowerCase();
  return CURATED_BASE_TOKENS.find((token) => token.address === normalized) ?? null;
}
