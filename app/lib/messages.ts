"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { EMPTY_SUMMARY, type Folder, type MessageSummary, type MessageView, type Peer, type SendMessageInput } from "@/app/lib/messageRules";

// The Messages dock's state (app/MessagesDock.tsx, mounted once by
// app/layout.tsx), shared with what opens it: the header's Messages buttons
// (app/MessagesButton.tsx — one per header layout, like the bell) and a
// profile's Message button. The header heartbeat (app/lib/liveChallenges.ts)
// keeps `summary` fresh; the dock refetches when `summary.latest` moves.

export const MESSAGES_DOCK_ID = "messages-dock";

export type DockView = { kind: "list"; folder: Folder } | { kind: "thread"; peer: Peer } | { kind: "new" };

type MessagesState = { open: boolean; view: DockView; summary: MessageSummary };

const INITIAL: MessagesState = { open: false, view: { kind: "list", folder: "inbox" }, summary: EMPTY_SUMMARY };
const listeners = new Set<() => void>();
let state = INITIAL;

function update(next: Partial<MessagesState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMessages() {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

/** From the heartbeat or an action's result; unchanged counts don't re-render anything. */
export function setMessageSummary(summary: MessageSummary) {
  const { inbox, requests, latest } = state.summary;
  if (summary.inbox === inbox && summary.requests === requests && summary.latest === latest) return;
  update({ summary });
}

export const toggleMessages = () => update({ open: !state.open });
export const closeMessages = () => update({ open: false });
/** Opens the dock on `view` — e.g. a conversation from a profile's Message button. */
export const showMessages = (view: DockView) => update({ open: true, view });
/** Signed out: nothing carries over to the next account. */
export const resetMessages = () => update(INITIAL);

const SEND_FAILED = "Couldn't send — try again.";

/** POST /api/messages/thread — the dock's composer and a post's Send dialog. The error is the server's own words when it has some. */
export async function postMessage(input: SendMessageInput): Promise<{ ok: true; message: MessageView } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/messages/thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const data: { message?: MessageView; error?: string } | null = await response.json().catch(() => null);
    if (response.ok && data?.message) return { ok: true, message: data.message };
    if (response.status === 413) return { ok: false, error: "Those photos are too large to send." };
    // Codes like "invalid-origin" aren't for people.
    return { ok: false, error: data?.error && /\s/.test(data.error) ? data.error : SEND_FAILED };
  } catch {
    return { ok: false, error: SEND_FAILED };
  }
}

/**
 * GET /api/messages/people as you type: your friends for an empty `query`,
 * else matching accounts (200ms after typing stops) — New message and a
 * post's Send dialog. Null until the first answer; `people` null = it failed.
 */
export function usePeople(query: string) {
  const [found, setFound] = useState<{ query: string; people: Peer[] | null } | null>(null);
  useEffect(() => {
    let live = true;
    const q = query.trim();
    const timer = setTimeout(
      () =>
        void fetch(`/api/messages/people?q=${encodeURIComponent(q)}`, { cache: "no-store" })
          .then((response) => (response.ok ? (response.json() as Promise<{ people: Peer[] }>) : null))
          .catch(() => null)
          .then((data) => {
            if (live) setFound({ query: q, people: data?.people ?? null });
          }),
      q ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return found;
}
