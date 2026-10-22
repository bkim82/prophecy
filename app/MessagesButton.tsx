"use client";

import { MessagesIcon } from "@/app/icons";
import { MESSAGES_DOCK_ID, toggleMessages, useMessages } from "@/app/lib/messages";

/**
 * Header envelope beside the bell (signed-in only, app/layout.tsx — one per
 * header layout, sharing app/lib/messages.ts). Opens and closes the Messages
 * dock (app/MessagesDock.tsx). The badge counts unread messages, inbox and
 * requests together, from the header heartbeat; reading a conversation
 * clears its share. Same button and badge as the bell (.notif-bell).
 */
export function MessagesButton() {
  const { open, summary } = useMessages();
  const unread = summary.inbox + summary.requests;
  return (
    <button
      type="button"
      className="notif-bell"
      aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      aria-expanded={open}
      aria-controls={MESSAGES_DOCK_ID}
      onClick={toggleMessages}
    >
      <MessagesIcon />
      {unread > 0 && (
        <span className="notif-badge" aria-hidden="true">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
