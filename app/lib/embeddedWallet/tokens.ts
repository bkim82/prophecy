export const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;

export type CuratedToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  maxSendRaw: bigint;
  maxDailySponsoredRaw: bigint;
};

export const CURATED_BASE_TOKENS = [
  {
    address: NATIVE_ETH,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    maxSendRaw: 100_000_000_000_000_000n,
    maxDailySponsoredRaw: 250_000_000_000_000_000n,
  },
  {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
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
