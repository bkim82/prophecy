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

// `sentAt` is ms since the epoch on the database clock. `body` may be "" when
// there are photos or a post. `post` is set when one was shared — null once
// it's been deleted.
export type MessageView = { id: string; body: string; mine: boolean; sentAt: number; photos: MessagePhoto[]; post?: SharedPost | null };

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
  if (message.post !== undefined) return "Shared a post";
  return message.photos.length > 1 ? `Sent ${message.photos.length} photos` : "Sent a photo";
}

// The header heartbeat's piece (POST /api/presence): unread messages per
// folder, and when the newest message to or from you was sent — the dock
// refetches whatever it shows when that moves.
export type MessageSummary = { inbox: number; requests: number; latest: number | null };

export const EMPTY_SUMMARY: MessageSummary = { inbox: 0, requests: 0, latest: null };

/** Trimmed, CRLF → LF, at most one blank line in a row (like the profile bio). */
export const normalizeMessage = (body: string) => body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
