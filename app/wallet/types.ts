// Unifies native ETH and ERC-20 holdings into one shape the dashboard renders
// identically. ETH uses the "eth" sentinel address everywhere a token address
// would go (API routes, history cache keys) since it has no contract address
// of its own but tracks WETH's market data.

export const ETH_SENTINEL = "eth";

export type Coin = {
  address: string; // "eth" for native ETH, else the ERC-20 contract address
  symbol: string;
  name: string;
  imageUrl: string | null;
  qty: number;
  priceUsd: number | null;
  valueUsd: number | null;
  change24h: number | null;
};

const MARKET_ACCENTS: Record<string, string> = {
  BTC: "var(--market-btc)",
  WBTC: "var(--market-btc)",
  CBBTC: "var(--market-btc)",
  ETH: "var(--market-eth)",
  WETH: "var(--market-eth)",
};

/** Orange for BTC-family, violet-blue for ETH-family, turquoise brand accent for everything else. */
export const coinAccent = (symbol: string) => MARKET_ACCENTS[symbol.toUpperCase()] ?? "var(--brand)";
