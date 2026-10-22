// Mock inbox for the header bell's Notifications (app/NotificationsMenu.tsx →
// app/FeedNotifications.tsx).
// Display-only like mockPosts.ts, and the same for every account — so no
// follows, challenges or copies: a new account has no followers, incoming
// challenges are real (GET /api/challenges/incoming), and copy trading isn't
// live (lib/activity.ts NO_COPY_EARNINGS). Newest first.
import type { Market, Side } from "@/app/lib/mockPosts";

export type Notification =
  | { id: string; kind: "mention"; handle: string; text: string; timestamp: string }
  | { id: string; kind: "copy"; handle: string; market: Market; side: Side; timestamp: string }
  | { id: string; kind: "follow"; handle: string; timestamp: string };

export const NOTIFICATIONS: Notification[] = [
  { id: "nt1", kind: "mention", handle: "@zane_lfg", text: "rematch tonight? same stakes, i want my embers back", timestamp: "9m ago" },
];

// The mock inbox ids; the bell adds real challenge ids to these for its unseen badge.
export const NOTIFICATION_IDS = NOTIFICATIONS.map((item) => item.id);
