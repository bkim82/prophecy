// Mock inbox for the header bell's Notifications (app/NotificationsMenu.tsx →
// app/FeedNotifications.tsx).
// Display-only like mockPosts.ts. Incoming challenges are hand-written too:
// real ones (lib/challenges.ts) only go out to mock traders, so nobody can
// send you one yet. Every challenger is someone canChallenge() (app/lib/rank.ts)
// lets challenge VIEWER_RANK (Gold II), i.e. Silver and up, and the terms are
// presets from app/lib/challengeRules.ts. Newest first.
import type { ChallengeMode } from "@/app/lib/challengeRules";
import type { Market, Side } from "@/app/lib/mockPosts";

export type ChallengeRequest = {
  id: string;
  handle: string;
  mode: ChallengeMode;
  market: string | null;
  timerSeconds: number | null;
  stake: number;
  timestamp: string;
};

export const CHALLENGE_REQUESTS: ChallengeRequest[] = [
  { id: "cr1", handle: "@nova_trades", mode: "pulse", market: "btc", timerSeconds: 120, stake: 250, timestamp: "3m ago" },
  { id: "cr2", handle: "@juno_dx", mode: "portfolio", market: null, timerSeconds: null, stake: 500, timestamp: "41m ago" },
];

// Everything below the challenge requests. Copies line up with the mock copy
// earnings on your profile (app/lib/mockViewer.ts), follows with VIEWER_FOLLOWERS.
export type Notification =
  | { id: string; kind: "mention"; handle: string; text: string; timestamp: string }
  | { id: string; kind: "copy"; handle: string; market: Market; side: Side; timestamp: string }
  | { id: string; kind: "follow"; handle: string; timestamp: string };

export const NOTIFICATIONS: Notification[] = [
  { id: "nt1", kind: "mention", handle: "@zane_lfg", text: "rematch tonight? same stakes, i want my embers back", timestamp: "9m ago" },
  { id: "nt2", kind: "copy", handle: "@ren.eth", market: "eth", side: "SHORT", timestamp: "26m ago" },
  { id: "nt3", kind: "follow", handle: "@lena_q", timestamp: "1h ago" },
  { id: "nt4", kind: "copy", handle: "@priya_p", market: "btc", side: "LONG", timestamp: "2h ago" },
];

// Every inbox id, challenges included — what the bell's unseen badge counts.
export const NOTIFICATION_IDS = [...CHALLENGE_REQUESTS, ...NOTIFICATIONS].map((item) => item.id);
