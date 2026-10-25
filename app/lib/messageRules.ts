// Direct-message shapes and limits — shared by the Messages dock
// (app/MessagesDock.tsx), a post's Send dialog (app/SharePostDialog.tsx) and
// the routes and server actions that re-check every value
// (app/api/messages/…, app/messages/actions.ts). Client-safe.
import { MAX_POST_PHOTOS } from "@/app/lib/postImage";

// Matches direct_messages_body_length (db/messages.sql).
export const MESSAGE_MAX_LENGTH = 1000;

// Inbox: people you follow each other with, or anyone you've accepted —
// replying accepts. Everyone else's messages wait in Requests.
export type Folder = "inbox" | "request";

export const folderFor = (friends: boolean, accepted: boolean): Folder => (friends || accepted ? "inbox" : "request");

// Someone you can message: a real account with a handle ("@sam").
export type Peer = { handle: string; name: string; imageUrl?: string };

// Photos per message, like a post's (app/lib/postImage.ts).
export const MESSAGE_MAX_PHOTOS = MAX_POST_PHOTOS;

export type MessagePhoto = { src: string; width: number; height: number };

// A post shared into a conversation, as its card in the thread shows it.
export type SharedPost = { id: string; href: string; author: string; handle: string; avatarInitial: string; content: string; rank?: string; imageUrl?: string };

// A challenge, posted into the conversation as it was sent
// (app/profile/challengeActions.ts), as it stands now (lib/challenges.ts
// challengeCardsFor). "closed" = its sender cleared it from their list.
// `expiresInMs` is measured by the server; 0 unless pending.
export type ChallengeStatus = "pending" | "accepted" | "declined" | "expired" | "canceled" | "closed";
export type ChallengeCard = { id: string; mode: string; terms: string; status: ChallengeStatus; expiresInMs: number };

// `sentAt` is ms since the epoch on the database clock. `body` may be "" when
// there are photos, a post or a challenge. `post` / `challenge` are set when
// one was attached — null once it's gone.
export type MessageView = {
  id: string;
  body: string;
  mine: boolean;
  sentAt: number;
  photos: MessagePhoto[];
  post?: SharedPost | null;
  challenge?: ChallengeCard | null;
};

export type ConversationView = { peer: Peer; last: MessageView; unread: number; folder: Folder };

// A block either way between you (lib/blocks.ts): no messages, no composer.
export type ThreadBlock = "by-you" | "by-them" | null;

// GET /api/messages/thread. `unread` counts their messages you haven't read;
// `newestUnreadId` is what marking it read reads up to.
export type ThreadView = { peer: Peer; messages: MessageView[]; folder: Folder; unread: number; newestUnreadId: string | null; blocked: ThreadBlock };

// What POST /api/messages/thread takes: text, photos (base64, from
// app/lib/pickedPhoto.ts encodePhoto) and/or a post id — at least one.
export type SendMessageInput = { handle: string; body?: string; photos?: { mime: string; data: string }[]; postId?: string };

/** A conversation row's one-line preview: the text, else what was attached. */
export function messagePreview(message: MessageView): string {
  if (message.body) return message.body;
  if (message.challenge !== undefined) return message.challenge ? `Challenge — ${message.challenge.terms}` : "Challenge";
  if (message.post !== undefined) return "Shared a post";
  return message.photos.length > 1 ? `Sent ${message.photos.length} photos` : "Sent a photo";
}

// A thread's layout, iMessage-style (app/MessagesDock.tsx): back-to-back
// messages from one side form a group — joined bubble corners, their avatar
// once beside the last. A pause of MESSAGE_GROUP_GAP_MS starts a new group
// (a little space between); one of MESSAGE_STAMP_GAP_MS, and the first
// message, get a centred timestamp above.
export const MESSAGE_GROUP_GAP_MS = 2 * 60_000;
export const MESSAGE_STAMP_GAP_MS = 60 * 60_000;

export type GroupPosition = "single" | "first" | "middle" | "last";

export function threadLayout(messages: Pick<MessageView, "mine" | "sentAt">[]): { stamp: boolean; position: GroupPosition }[] {
  const joined = (index: number) => {
    const before = messages[index - 1];
    const message = messages[index];
    return Boolean(before && message) && before.mine === message.mine && message.sentAt - before.sentAt < MESSAGE_GROUP_GAP_MS;
  };
  return messages.map((message, index) => {
    const joinsBefore = joined(index);
    const joinsAfter = joined(index + 1);
    return {
      stamp: index === 0 || message.sentAt - messages[index - 1].sentAt >= MESSAGE_STAMP_GAP_MS,
      position: joinsBefore ? (joinsAfter ? "middle" : "last") : joinsAfter ? "first" : "single",
    };
  });
}

const stampTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const stampWeekday = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const stampDate = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const stampFullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** A thread timestamp in the viewer's time zone: "Today 3:42 PM", "Yesterday …", "Tuesday …", "Sat, Oct 12 at …", "Oct 12, 2025 at …". */
export function stampLabel(sentAt: number, now: number): string {
  const time = stampTime.format(sentAt);
  // Rounded: a day across a DST change is 23 or 25 hours.
  const days = Math.round((startOfDay(now) - startOfDay(sentAt)) / 86_400_000);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${stampWeekday.format(sentAt)} ${time}`;
  const sameYear = new Date(sentAt).getFullYear() === new Date(now).getFullYear();
  return `${(sameYear ? stampDate : stampFullDate).format(sentAt)} at ${time}`;
}

// The header heartbeat's piece (POST /api/presence): unread messages per
// folder, and when the newest message to or from you was sent — the dock
// refetches whatever it shows when that moves.
export type MessageSummary = { inbox: number; requests: number; latest: number | null };

export const EMPTY_SUMMARY: MessageSummary = { inbox: 0, requests: 0, latest: null };

/** Trimmed, CRLF → LF, at most one blank line in a row (like the profile bio). */
export const normalizeMessage = (body: string) => body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
