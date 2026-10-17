export const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export const formatEth = (rawBalance: string) => {
  const wei = BigInt(rawBalance);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
};

export const BASE_CHAIN_ID = 8453 as const;
export const isBaseChain = (chainId: number | null) => chainId === BASE_CHAIN_ID;
