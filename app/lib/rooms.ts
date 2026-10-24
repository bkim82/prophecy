// The Oracle Room (app/sanctum/page.tsx): a real-money Pulse room for your
// rank only. Client-only for now — no backend, no settlement, and no other
// players connected, so the room shows only your own trades and messages.
// See docs/sanctum.md.
import { pickDailyCoin } from "@/app/DailyCoin";
import type { RoomId } from "@/app/lib/rank";

export type RoomCoin = "btc" | "eth" | "daily";
export type RoomSide = "long" | "short";
export { RANK_TIERS, isRoomId, type RoomId } from "@/app/lib/rank";

export type RoomCoinMeta = {
  id: RoomCoin;
  market: "btc" | "eth" | "hype"; // drives [data-market] accent colours
  ticker: string;
  product: string;
  symbol: string;
  symbolClass: string;
};

const DAILY = pickDailyCoin();
const DAILY_MARKET = DAILY.toLowerCase() as "hype";

export const ROOM_COINS: RoomCoinMeta[] = [
  { id: "btc", market: "btc", ticker: "BTC", product: "BTC-USD", symbol: "₿", symbolClass: "btc-symbol" },
  { id: "eth", market: "eth", ticker: "ETH", product: "ETH-USD", symbol: "Ξ", symbolClass: "eth-symbol" },
  { id: "daily", market: DAILY_MARKET, ticker: DAILY, product: `${DAILY}-USD`, symbol: DAILY[0], symbolClass: `${DAILY_MARKET}-symbol` },
];

export const coinMeta = (coin: RoomCoin) => ROOM_COINS.find((c) => c.id === coin) ?? ROOM_COINS[0];

// Hardcoded until a real per-user rank exists (see app/lib/rank.ts stub).
export const ROOM = {
  tier: "oracle" as RoomId,
  rank: "Oracle",
  subrank: "Oracle II",
  label: "The Oracle Room",
  eyebrow: "Rank · Oracle",
  tagline: "Real stakes, read in the signs. Only Oracles trade here.",
};

export type RoomChatMessage = { id: string; author: string; text: string; time: number };
