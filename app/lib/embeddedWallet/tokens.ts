export const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

/**
 * CDP's ERC-20 paymaster on Base mainnet: it pays gas in ETH and pulls the fee
 * in USDC from the smart account (https://docs.cdp.coinbase.com/paymaster/guides/erc20-gas-payments).
 */
export const CDP_ERC20_PAYMASTER = "0x2faeb0760d4230ef2ac21496bb4f0b47d634fd4c" as const;

/** USDC allowance re-approved to the paymaster on every send; caps the gas fee it can pull. */
export const GAS_ALLOWANCE_RAW = 1_000_000n;

/**
 * A token a send can move. Limits are set only for the curated tokens below;
 * any other ERC-20 (decimals from Alchemy metadata) is bounded by its balance.
 */
export type SendToken = {
  address: string;
  symbol: string;
  decimals: number;
  maxSendRaw: bigint | null;
  maxDailyRaw: bigint | null;
};

export const CURATED_BASE_TOKENS = [
  {
    address: NATIVE_ETH,
    symbol: "ETH",
    decimals: 18,
    maxSendRaw: 100_000_000_000_000_000n,
    maxDailyRaw: 250_000_000_000_000_000n,
  },
  {
    address: USDC_BASE,
    symbol: "USDC",
    decimals: 6,
    maxSendRaw: 100_000_000n,
    maxDailyRaw: 250_000_000n,
  },
] as const satisfies readonly SendToken[];

export function curatedToken(address: string): SendToken | null {
  const normalized = address.toLowerCase();
  return CURATED_BASE_TOKENS.find((token) => token.address === normalized) ?? null;
}

/** Uniswap's Permit2 (same address on every chain); CDP swaps pull the sold ERC-20 through it. */
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;

/** Max slippage passed to CDP's swap quote/execute, in basis points (100 = 1%). */
export const SWAP_SLIPPAGE_BPS = 100;
