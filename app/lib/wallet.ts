import { createCoinbaseWalletSDK } from "@coinbase/wallet-sdk";

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};

let coinbaseProvider: EthereumProvider | undefined;

// Coinbase Wallet SDK's popup flow needs no browser extension: it either links an
// existing Coinbase Wallet (scan with the mobile app) or spins up a new passkey-backed
// Smart Wallet on the spot. Memoized so every caller shares one connected session.
export const getWalletProvider = (): EthereumProvider | undefined => {
  if (typeof window === "undefined") return undefined;
  if (!coinbaseProvider) {
    const sdk = createCoinbaseWalletSDK({
      appName: "Prophecy",
      appChainIds: [8453],
      preference: { options: "all" },
    });
    coinbaseProvider = sdk.getProvider() as unknown as EthereumProvider;
  }
  return coinbaseProvider;
};

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

export const BASE_CHAIN_ID = "0x2105";

export const BASE_CHAIN_PARAMS = {
  chainId: BASE_CHAIN_ID,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export const isBaseChain = (chainId: string) => chainId.toLowerCase() === BASE_CHAIN_ID;

export const switchToBase = async (provider: EthereumProvider) => {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [BASE_CHAIN_PARAMS] });
    } else {
      throw error;
    }
  }
};
