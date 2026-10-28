"use client";

import { useRef, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import type { Reply } from "@/app/lib/posts";
import type { Reshare } from "@/app/PostShare";

// Client side of the like / repost / reply routes under
// /api/posts/[id] (lib/engagement.ts), used by app/PostCard.tsx and
// app/PostReplies.tsx.

const postPath = (postId: string) => `/api/posts/${encodeURIComponent(postId)}`;
const replyPath = (postId: string, replyId: string) => `${postPath(postId)}/replies/${encodeURIComponent(replyId)}`;

async function send(path: string, body: object, method = "POST"): Promise<Response | null> {
  return fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
}

const saved = (response: Response | null) => response?.ok === true;

export const saveLike = async (postId: string, liked: boolean) => saved(await send(`${postPath(postId)}/like`, { liked }));

export const saveReshare = async (postId: string, reshare: Reshare | null) =>
  saved(await send(`${postPath(postId)}/reshare`, reshare ? { kind: reshare.kind, text: reshare.text } : { kind: null }));

export const saveReplyLike = async (postId: string, replyId: string, liked: boolean) =>
  saved(await send(`${replyPath(postId, replyId)}/like`, { liked }));

/** A post's replies, newest first; null when they couldn't be loaded. */
export async function loadReplies(postId: string): Promise<Reply[] | null> {
  const response = await fetch(`${postPath(postId)}/replies`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { replies?: Reply[] } | null;
  return body?.replies ?? null;
}

export type ReplyResult = { ok: true; reply: Reply } | { ok: false; status: number; error: string };

export async function publishReply(postId: string, content: string, parentId?: string): Promise<ReplyResult> {
  const response = await send(`${postPath(postId)}/replies`, { content, ...(parentId ? { parentId } : {}) });
  if (!response) return { ok: false, status: 0, error: "Couldn't reach Prophecy. Check your connection and try again." };
  const body = (await response.json().catch(() => ({}))) as { reply?: Reply; error?: string };
  if (response.ok && body.reply) return { ok: true, reply: body.reply };
  return { ok: false, status: response.status, error: body.error ?? "Couldn't reply. Try again." };
}

export type EditResult = { ok: true; content: string } | { ok: false; error: string };

/** New words for your own reply; resolves to what was saved (trimmed). */
export async function editReply(postId: string, replyId: string, content: string): Promise<EditResult> {
  const response = await send(replyPath(postId, replyId), { content }, "PATCH");
  const body = (await response?.json().catch(() => ({}))) as { content?: string; error?: string } | undefined;
  if (response?.ok && body?.content) return { ok: true, content: body.content };
  return { ok: false, error: body?.error ?? "Couldn't save your edit. Try again." };
}

export const deleteReply = async (postId: string, replyId: string) => saved(await send(replyPath(postId, replyId), {}, "DELETE"));

/**
 * A saved toggle (like, repost): the change shows at once and rolls back if
 * the save fails. Signed out it opens sign-in instead; while one save is in
 * flight further changes are ignored.
 */
export function useSaved<T>(initial: T, save: (next: T) => Promise<boolean>): [T, (next: T) => void] {
  const { isSignedIn, openSignIn } = useAppAuth();
  const [value, setValue] = useState(initial);
  const pending = useRef(false);

  function change(next: T) {
    if (pending.current) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    const previous = value;
    pending.current = true;
    setValue(next);
    void save(next).then((ok) => {
      pending.current = false;
      if (!ok) setValue(previous);
    });
  }

  return [value, change];
}
