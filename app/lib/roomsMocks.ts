// Mock content for the Rooms placeholder (app/rooms/page.tsx). Display-only,
// no backend — establishes the rank-gated group-chat concept. See docs/rooms.md.
import type { Market, Side } from "@/app/lib/mockPosts";

export type RoomId = "bronze" | "silver" | "gold" | "diamond" | "oracle";
export type RoomRankStatus = "cleared" | "current" | "locked";

export type RoomCall = { market: Market; side: Side; price: string; window: string };

export type RoomMessage = {
  id: string;
  author: string;
  text: string;
  time: string;
  call?: RoomCall;
  challengeLabel?: string;
};

export type Room = {
  id: RoomId;
  label: string;
  rankLabel: string; // tier name shown in permission copy, e.g. "Diamond"
  eyebrow: string;
  chip: string;
  tagline: string;
  online: number;
  messages: RoomMessage[];
};

// Hardcoded until a real per-user rank exists (see app/lib/rank.ts stub).
export const USER_ROOM_ID: RoomId = "gold";
export const USER_SUBRANK = "Gold II";

export const ROOMS: Room[] = [
  {
    id: "bronze",
    label: "Bronze Room",
    rankLabel: "Bronze",
    eyebrow: "The Forge",
    chip: "Bronze Prophecies",
    tagline: "Where every prophet strikes their first call.",
    online: 412,
    messages: [
      { id: "b1", author: "Pip", text: "First duel today, went LONG on DOGE and it actually hit 😅", time: "7:12 PM" },
      {
        id: "b2",
        author: "Marlo",
        text: "DOGE pumping again, calling 20c by morning.",
        time: "7:15 PM",
        call: { market: "doge", side: "LONG", price: "$0.20", window: "By morning" },
        challengeLabel: "Challenge",
      },
      { id: "b3", author: "Juno", text: "Anyone know how the 60s Pulse windows settle?", time: "7:19 PM" },
    ],
  },
  {
    id: "silver",
    label: "Silver Room",
    rankLabel: "Silver",
    eyebrow: "The Mint",
    chip: "Silver Prophecies",
    tagline: "Sharper reads, steadier hands.",
    online: 268,
    messages: [
      {
        id: "s1",
        author: "Wren",
        text: "ETH reclaiming 3.5K feels clean. Short-term long.",
        time: "8:02 PM",
        call: { market: "eth", side: "LONG", price: "$3,500", window: "4h" },
        challengeLabel: "Challenge",
      },
      { id: "s2", author: "Castor", text: "Volume's thin though. I'd wait for the retest.", time: "8:05 PM" },
      { id: "s3", author: "Lio", text: "Two more wins and I'm out of Silver. Wish me luck.", time: "8:09 PM" },
    ],
  },
  {
    id: "gold",
    label: "Gold Room",
    rankLabel: "Gold",
    eyebrow: "The Vault",
    chip: "Gold Prophecies",
    tagline: "Proven callers trading conviction.",
    online: 131,
    messages: [
      {
        id: "g1",
        author: "Nova",
        text: "BTC breaks 70K tonight.",
        time: "8:41 PM",
        call: { market: "btc", side: "LONG", price: "$70,000", window: "Tonight" },
        challengeLabel: "Challenge",
      },
      { id: "g2", author: "Ren", text: "No shot. Taking the other side.", time: "8:43 PM", challengeLabel: "Challenge Ren" },
      { id: "g3", author: "8bit Kay", text: "ETH still lagging majors, watching 3.4K support before I call anything.", time: "8:45 PM" },
    ],
  },
  {
    id: "diamond",
    label: "Diamond Room",
    rankLabel: "Diamond",
    eyebrow: "The Facet",
    chip: "Diamond Prophecies",
    tagline: "Pressure-tested. Only the clearest reads survive.",
    online: 38,
    messages: [
      {
        id: "d1",
        author: "Vega",
        text: "Funding flipped negative on BTC while spot bid holds. Fading the shorts.",
        time: "9:02 PM",
        call: { market: "btc", side: "LONG", price: "$68,400", window: "1h" },
        challengeLabel: "Challenge",
      },
      { id: "d2", author: "Sable", text: "Agreed on direction, disagree on timing. Liquidity sits 300 lower first.", time: "9:04 PM" },
      { id: "d3", author: "Ixion", text: "Logged 14-3 this week. ETH/BTC ratio is the tell, not the chart.", time: "9:07 PM" },
    ],
  },
  {
    id: "oracle",
    label: "Oracle Room",
    rankLabel: "Oracle",
    eyebrow: "The Sanctum",
    chip: "Oracle Prophecies",
    tagline: "The few whose words move the market.",
    online: 7,
    messages: [
      {
        id: "o1",
        author: "Seraph",
        text: "ETH sheds 5% before the weekly close. Mark it.",
        time: "9:30 PM",
        call: { market: "eth", side: "SHORT", price: "$3,230", window: "Weekly close" },
        challengeLabel: "Challenge",
      },
      { id: "o2", author: "Thalia", text: "Seen. I'll take the other side for the season title.", time: "9:31 PM", challengeLabel: "Challenge Thalia" },
      { id: "o3", author: "Morrow", text: "The quiet before the candle is always the loudest tell.", time: "9:36 PM" },
    ],
  },
];

const USER_ROOM_INDEX = ROOMS.findIndex((room) => room.id === USER_ROOM_ID);

export function roomStatus(roomId: RoomId): RoomRankStatus {
  const index = ROOMS.findIndex((room) => room.id === roomId);
  if (index === USER_ROOM_INDEX) return "current";
  return index < USER_ROOM_INDEX ? "cleared" : "locked";
}

// Every room is viewable; chatting requires the user's rank to reach the room's tier.
export function canChatInRoom(roomId: RoomId): boolean {
  return roomStatus(roomId) !== "locked";
}
