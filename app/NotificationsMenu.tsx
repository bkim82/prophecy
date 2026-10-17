"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { FeedNotifications } from "@/app/FeedNotifications";
import { BellIcon } from "@/app/icons";
import { NOTIFICATION_IDS } from "@/app/lib/mockNotifications";
import { useSeenNotifications } from "@/app/lib/postLists";

/**
 * Header bell beside the account avatar (signed-in only, app/layout.tsx).
 * The badge counts inbox items this browser hasn't opened the bell on yet;
 * opening it marks them all seen. The popover stays mounted while closed so
 * challenge answers survive closing it.
 */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const seen = useSeenNotifications();
  const seenIds = seen.ids;
  const unseen = seenIds === null ? 0 : NOTIFICATION_IDS.filter((id) => !seenIds.includes(id)).length;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (!open && unseen > 0) seen.markSeen(NOTIFICATION_IDS);
    setOpen(!open);
  };

  // Rows link to profiles; following one closes the popover.
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as Element).closest("a")) setOpen(false);
  };

  return (
    <div ref={rootRef} className="notif-menu">
      <button
        type="button"
        className="notif-bell"
        aria-label={unseen > 0 ? `Notifications, ${unseen} new` : "Notifications"}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={toggle}
      >
        <BellIcon />
        {unseen > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      <div id={popoverId} className="notif-popover" role="dialog" aria-label="Notifications" hidden={!open} onClick={closeOnLink}>
        <FeedNotifications />
      </div>
    </div>
  );
}
