"use server";

import type { MessageSummary } from "@/app/lib/messageRules";
import { acceptThread, clearThread, markThreadRead, messageSummaryFor } from "@/lib/messages";
import { publicProfileFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

// The Messages dock's conversation actions (app/MessagesDock.tsx). Sending
// is POST /api/messages/thread instead — photos outgrow a server action's
// 1 MB body. Actions that change unread counts hand back the fresh summary so
// the header badge drops at once instead of on the next heartbeat.

type Failure = { ok: false; error: string };
export type SummaryResult = { ok: true; summary: MessageSummary } | Failure;
export type AcceptResult = { ok: true } | Failure;

const UNAVAILABLE: Failure = { ok: false, error: "That trader can't receive messages." };

// The account holding `handle` ("@sam" or "sam"), unless it's you.
async function recipient(userId: string, handle: unknown) {
  if (typeof handle !== "string" || handle.length > 40) return null;
  const account = await publicProfileFor(handle.replace(/^@/, "").toLowerCase());
  return account && account.userId !== userId ? account : null;
}

/** Marks the conversation read up to `messageId`, the newest of their messages you've seen. */
export async function markConversationRead(handle: string, messageId: string): Promise<SummaryResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to read messages." };
  const peer = await recipient(userId, handle);
  if (!peer || typeof messageId !== "string" || messageId.length > 64) return UNAVAILABLE;
  await markThreadRead(userId, peer.userId, messageId);
  return { ok: true, summary: await messageSummaryFor(userId) };
}

/** Accepts a message request: the conversation moves to your inbox and you can reply. */
export async function acceptConversation(handle: string): Promise<AcceptResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to accept messages." };
  const peer = await recipient(userId, handle);
  if (!peer) return UNAVAILABLE;
  await acceptThread(userId, peer.userId);
  return { ok: true };
}

/** Deletes a conversation for you only; they keep their copy. */
export async function deleteConversation(handle: string): Promise<SummaryResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to delete messages." };
  const peer = await recipient(userId, handle);
  if (!peer) return UNAVAILABLE;
  await clearThread(userId, peer.userId);
  return { ok: true, summary: await messageSummaryFor(userId) };
}
