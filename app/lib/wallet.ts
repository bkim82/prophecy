export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const getWalletProvider = () =>
  typeof window !== "undefined" ? window.ethereum : undefined;

export const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export const formatEth = (hexBalance: string) => {
  const wei = BigInt(hexBalance);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
};

export const chainName = (chainId: string) => {
  const names: Record<string, string> = {
    "0x1": "Ethereum",
    "0x89": "Polygon",
    "0xa": "Optimism",
    "0xa4b1": "Arbitrum",
    "0x2105": "Base",
    "0x14a34": "Base Sepolia",
  };
  return names[chainId.toLowerCase()] ?? "Unknown network";
};
