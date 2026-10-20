export const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export const formatEth = (rawBalance: string) => {
  const wei = BigInt(rawBalance);
  const whole = wei / 10n ** 18n;
  const digits = (wei % 10n ** 18n).toString().padStart(18, "0");
  // Dust under 0.0001 ETH keeps 4 significant digits instead of rounding to "0.0000",
  // which callers parse with Number() and would hide as a zero balance.
  const firstNonZero = digits.search(/[1-9]/);
  const places = whole === 0n && firstNonZero >= 4 ? firstNonZero + 4 : 4;
  return `${whole}.${digits.slice(0, places)}`;
};

export const BASE_CHAIN_ID = 8453 as const;
export const isBaseChain = (chainId: number | null) => chainId === BASE_CHAIN_ID;
