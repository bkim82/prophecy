import type { TopicId } from "@/app/lib/topics";

// One of your own trades, as GET /api/trades/recent returns it and as it's
// snapshotted onto a post (Post.trade) when you attach it in the composer
// (app/compose/TradePicker.tsx). Client-safe: no DB import. Two sources:
// - "portfolio": a 24h Portfolio position (`positions` row). Open ones are
//   marked at the live price, so their P&L is as of when the list loaded.
// - "arena": a settled Pulse match. Pulse clears side/leverage at settlement
//   (lib/match.ts settleIfDue), so a round only keeps its P&L and result.
export type TradeSource = "portfolio" | "arena";

// "portfolio:<positions.id>" | "arena:<matches.id>" — a receipt's `id`, and
// the only shape a saved post's trade ref may take (POST /api/posts).
export const TRADE_REF = /^(portfolio|arena):([A-Za-z0-9-]{1,64})$/;
export const isTradeRef = (value: unknown): value is string => typeof value === "string" && TRADE_REF.test(value);

export type TradeReceipt = {
  id: string; // "portfolio:<positionId>" | "arena:<matchId>"
  source: TradeSource;
  symbol: string; // ticker, no "$"
  name: string;
  imageUrl: string | null;
  // Spot buy, leveraged long/short, or an Arena round (no side kept).
  position: "spot" | "long" | "short" | "round";
  leverage: number | null;
  entryPrice: number | null;
  // Exit price once closed; the mark price while open.
  exitPrice: number | null;
  open: boolean;
  // Return on what was put in: P&L ÷ committed cash (portfolio), round P&L ÷
  // the round's starting cash (arena).
  roiPct: number;
  // Embers: realized/unrealized P&L (portfolio), ±wager (arena).
  pnl: number;
  // Closed (or opened, while open) — ms epoch.
  at: number;
  // Arena only: "won" | "lost" | "tie", opponent and round length.
  result?: "won" | "lost" | "tie";
  opponent?: string;
  roundSeconds?: number;
  // Saved posts only, open trades only: the return when the omen was posted
  // (server-computed at write time), shown beside the live figure.
  roiAtPost?: number;
};

// Arena markets have no token logo; they use the lobby's glyphs.
export const ARENA_GLYPHS: Record<string, { glyph: string; className: string }> = {
  BTC: { glyph: "₿", className: "btc-symbol" },
  ETH: { glyph: "Ξ", className: "eth-symbol" },
  HYPE: { glyph: "H", className: "hype-symbol" },
};

// Tickers that map onto a feed topic, so a trade post shows under that coin's
// chip (app/lib/topics.ts postTopics).
const SYMBOL_TOPICS: Record<string, TopicId> = {
  BTC: "bitcoin",
  WBTC: "bitcoin",
  CBBTC: "bitcoin",
  ETH: "ethereum",
  WETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  PEPE: "pepe",
  BONK: "bonk",
  WIF: "wif",
  BRETT: "brett",
  HYPE: "hype",
};

export const tradeTopic = (trade: TradeReceipt): TopicId | undefined => SYMBOL_TOPICS[trade.symbol.toUpperCase()];

export const roundLength = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

// "LONG 3×" / "SPOT" / "PULSE 1m" — the side tag on picker rows and cards.
export function tradeSideLabel(trade: TradeReceipt): string {
  if (trade.position === "round") return trade.roundSeconds ? `Pulse ${roundLength(trade.roundSeconds)}` : "Pulse";
  if (trade.position === "spot") return "Spot";
  return `${trade.position === "long" ? "Long" : "Short"}${trade.leverage ? ` ${trade.leverage}×` : ""}`;
}

// Composer placeholder once a trade is attached.
export function tradePrompt(trade: TradeReceipt): string {
  const ticker = `$${trade.symbol}`;
  if (trade.open) return `What's the plan for this ${ticker} trade?`;
  if (trade.position === "round") return trade.result === "won" ? `How'd you take that ${ticker} round?` : `What happened in that ${ticker} round?`;
  return trade.pnl >= 0 ? `How'd you call ${ticker}?` : `What went wrong on ${ticker}?`;
}
