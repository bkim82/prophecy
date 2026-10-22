"use client";

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { FeedNotifications } from "@/app/FeedNotifications";
import { BellIcon } from "@/app/icons";
import type { IncomingChallenge } from "@/app/lib/challengeRules";
import { NOTIFICATION_IDS } from "@/app/lib/mockNotifications";
import { useSeenNotifications } from "@/app/lib/postLists";

/**
 * Header bell beside the account avatar (signed-in only, app/layout.tsx).
 * The badge counts inbox items this browser hasn't opened the bell on yet;
 * opening it marks them all seen. Real incoming challenges are fetched on
 * load and again on each open. The popover stays mounted while closed so
 * a "Declined" row survives closing it.
 */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const seen = useSeenNotifications();
  const seenIds = seen.ids;
  const [challenges, setChallenges] = useState<IncomingChallenge[]>([]);
  const ids = [...challenges.map((challenge) => challenge.id), ...NOTIFICATION_IDS];
  const unseen = seenIds === null ? 0 : ids.filter((id) => !seenIds.includes(id)).length;

  const loadChallenges = useCallback(() => {
    fetch("/api/challenges/incoming", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { challenges: IncomingChallenge[] } | null) => {
        if (data) setChallenges(data.challenges);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

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
    if (!open) {
      if (unseen > 0) seen.markSeen(ids);
      loadChallenges();
    }
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
        <FeedNotifications challenges={challenges} />
      </div>
    </div>
  );
}
