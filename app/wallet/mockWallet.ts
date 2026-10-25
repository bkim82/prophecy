import type { WalletState } from "@/app/lib/useWalletConnection";
import { USDC_BASE } from "@/app/lib/embeddedWallet/tokens";
import type { WalletTokenHolding } from "@/lib/alchemy";
import type { ActivityEntry } from "./ActivityList";

// Local-dev stand-in for a signed-in wallet: sign-in can't complete on localhost,
// so `next dev` renders the dashboard against these fixtures instead. Only the
// wallet-specific reads (balance, holdings, activity) are faked; tokens are real
// Base contracts, so prices, charts and trending still come from the live routes.

export const WALLET_MOCK_ENABLED = process.env.NODE_ENV === "development";

export const MOCK_WALLET: WalletState = {
  address: "0x5afe00000000000000000000000000000000beef",
  chainId: 8453,
  chain: "Base",
  balance: "0.4213",
};

const holding = (address: string, symbol: string, name: string, balance: number, priceUsd: number, change24h: number): WalletTokenHolding => ({
  address, symbol, name, decimals: 18, balance, priceUsd, valueUsd: balance * priceUsd, imageUrl: null, change24h,
});

export const MOCK_HOLDINGS: WalletTokenHolding[] = [
  { ...holding(USDC_BASE, "USDC", "USD Coin", 1250.42, 1, 0.01), decimals: 6 },
  holding("0x940181a94a35a4569e4529a3cdfb74e38fd98631", "AERO", "Aerodrome", 820, 0.92, 4.8),
  holding("0x4ed4e862860bed51a9570b96d89af5e1b0efefed", "DEGEN", "Degen", 154000, 0.0042, -7.3),
  holding("0x532f27101965dd16442e59d40670faf5ebb142e4", "BRETT", "Brett", 3100, 0.061, 12.6),
  holding("0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4", "TOSHI", "Toshi", 2_400_000, 0.00031, -1.9),
];

const HOUR = 60 * 60_000;
const mockHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const ago = (hours: number) => Date.now() - hours * HOUR;

export const MOCK_ACTIVITY: ActivityEntry[] = [
  { hash: mockHash(1), kind: "swapped", asset: "USDC", value: 150, toAsset: "BRETT", toValue: 2459.02, timestamp: ago(0.5), local: true, status: "submitted" },
  { hash: mockHash(2), kind: "received", asset: "USDC", value: 500, toAsset: null, toValue: null, timestamp: ago(3) },
  { hash: mockHash(3), kind: "swapped", asset: "ETH", value: 0.05, toAsset: "AERO", toValue: 172.4, timestamp: ago(20) },
  { hash: mockHash(4), kind: "sent", asset: "USDC", value: 75, toAsset: null, toValue: null, timestamp: ago(46), recipient: "0x1234567890abcdef1234567890abcdef12345678" },
  { hash: mockHash(5), kind: "received", asset: "ETH", value: 0.5, toAsset: null, toValue: null, timestamp: ago(70) },
  { hash: mockHash(6), kind: "swapped", asset: "USDC", value: 40, toAsset: "DEGEN", toValue: 9876.5, timestamp: ago(120), local: true, status: "reverted" },
];
