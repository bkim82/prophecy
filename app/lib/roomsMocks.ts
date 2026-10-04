// Mock content for the Oracle Room (app/sanctum/page.tsx): a real-money Pulse
// room for your rank only. Display-only — no backend, no settlement, no
// other players actually connected. See docs/rooms.md.
import { pickDailyCoin } from "@/app/DailyCoin";

export type RoomCoin = "btc" | "eth" | "daily";
export type RoomSide = "long" | "short";

export type RoomCoinMeta = {
  id: RoomCoin;
  market: "btc" | "eth" | "doge"; // drives [data-market] accent colours
  ticker: string;
  product: string;
  symbol: string;
  symbolClass: string;
};

const DAILY = pickDailyCoin();
const DAILY_MARKET = DAILY.toLowerCase() as "doge";

export const ROOM_COINS: RoomCoinMeta[] = [
  { id: "btc", market: "btc", ticker: "BTC", product: "BTC-USD", symbol: "₿", symbolClass: "btc-symbol" },
  { id: "eth", market: "eth", ticker: "ETH", product: "ETH-USD", symbol: "Ξ", symbolClass: "eth-symbol" },
  { id: "daily", market: DAILY_MARKET, ticker: DAILY, product: `${DAILY}-USD`, symbol: DAILY === "DOGE" ? "Ð" : DAILY[0], symbolClass: `${DAILY_MARKET}-symbol` },
];

export const coinMeta = (coin: RoomCoin) => ROOM_COINS.find((c) => c.id === coin) ?? ROOM_COINS[0];

// Hardcoded until a real per-user rank exists (see app/lib/rank.ts stub).
export const ROOM = {
  rank: "Oracle",
  subrank: "Oracle II",
  label: "The Oracle Room",
  eyebrow: "Rank · Oracle",
  tagline: "Real stakes, read in the signs. Only Oracles trade here.",
  online: 64,
};

// Who else is in the room. `bias` nudges their side so the feed has
// personalities instead of coin flips; `size` is their typical USD stake.
export type RoomMember = { name: string; bias: number; size: [number, number]; leverage: number[] };

export const ROOM_MEMBERS: RoomMember[] = [
  { name: "Brandon", bias: 0.7, size: [150, 500], leverage: [100, 1000] },
  { name: "Seraph", bias: 0.35, size: [200, 900], leverage: [1000] },
  { name: "Thalia", bias: 0.5, size: [50, 250], leverage: [100] },
  { name: "Morrow", bias: 0.4, size: [80, 300], leverage: [100, 1000, 10000] },
  { name: "Vega", bias: 0.6, size: [300, 1200], leverage: [100] },
  { name: "Ixion", bias: 0.55, size: [100, 400], leverage: [1000, 10000] },
  { name: "Nyx", bias: 0.45, size: [60, 220], leverage: [100, 1000] },
  { name: "Cassia", bias: 0.5, size: [120, 600], leverage: [1000] },
];

export type RoomChatMessage = { id: string; author: string; text: string; time: number };

const minutesAgo = (m: number) => Date.now() - m * 60_000;

export const seedChat = (): RoomChatMessage[] => [
  { id: "c1", author: "Seraph", text: "Funding's flipping. Shorts are about to pay rent.", time: minutesAgo(9) },
  { id: "c2", author: "Brandon", text: "Longed BTC into the wick. Not letting go till 1%.", time: minutesAgo(6) },
  { id: "c3", author: `Thalia`, text: `${DAILY} daily coin is moving like it heard something.`, time: minutesAgo(4) },
  { id: "c4", author: "Morrow", text: "The quiet before the candle is always the loudest tell.", time: minutesAgo(2) },
];

// Lines a member might drop into chat after their own trade — grounded in the
// trade that just appeared in the feed, never commentary on activity that
// didn't happen.
export const chatLineFor = (side: RoomSide, ticker: string, pnl?: number) => {
  if (pnl !== undefined) {
    return pnl >= 0
      ? [`Took ${ticker} off the table. Green is green.`, `Booked it. ${ticker} gave what it promised.`]
      : [`${ticker} stopped me out. The sign was false.`, `Cut ${ticker}. Living to read another candle.`];
  }
  return side === "long"
    ? [`${ticker} looks heavy on the bid. I'm in.`, `Long ${ticker}. The signs point up.`]
    : [`Fading ${ticker} here.`, `${ticker} short — that top won't hold.`];
};

export const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
