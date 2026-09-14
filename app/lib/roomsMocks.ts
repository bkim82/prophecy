// Mock content for the Rooms placeholder (app/rooms/page.tsx). Display-only,
// no backend — establishes the rank-gated group-chat concept. See docs/rooms.md.
import type { Market, Side } from "@/app/lib/mockPosts";

export type RoomRankStatus = "cleared" | "current" | "locked";
export type RoomRank = { id: string; label: string; status: RoomRankStatus };

export const CURRENT_ROOM_LABEL = "Gold Room";
export const CURRENT_ROOM_SUBRANK = "Gold II";

export const ROOM_LADDER: RoomRank[] = [
  { id: "bronze", label: "Bronze Room", status: "cleared" },
  { id: "silver", label: "Silver Room", status: "cleared" },
  { id: "gold", label: "Gold Room", status: "current" },
  { id: "diamond", label: "Diamond Room", status: "locked" },
  { id: "oracle", label: "Oracle Room", status: "locked" },
];

export type RoomCall = { market: Market; side: Side; price: string; window: string };

export type RoomMessage = {
  id: string;
  author: string;
  text: string;
  time: string;
  call?: RoomCall;
  challengeLabel?: string;
};

export const ROOM_MESSAGES: RoomMessage[] = [
  {
    id: "r1",
    author: "Nova",
    text: "BTC breaks 70K tonight.",
    time: "8:41 PM",
    call: { market: "btc", side: "LONG", price: "$70,000", window: "Tonight" },
    challengeLabel: "Challenge",
  },
  {
    id: "r2",
    author: "Ren",
    text: "No shot. Taking the other side.",
    time: "8:43 PM",
    challengeLabel: "Challenge Ren",
  },
  {
    id: "r3",
    author: "8bit Kay",
    text: "ETH still lagging majors, watching 3.4K support before I call anything.",
    time: "8:45 PM",
  },
];
