"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { AcceptedRow, ChallengeRow, FeedNotifications } from "@/app/FeedNotifications";
import { ArenaIcon, BellIcon } from "@/app/icons";
import { heartbeat, useLiveChallenges } from "@/app/lib/liveChallenges";
import { useSeenNotifications } from "@/app/lib/postLists";

/**
 * Header bell beside the account avatar (signed-in only, app/layout.tsx).
 * The badge counts inbox items this browser hasn't opened the bell on yet;
 * opening it marks them all seen. Live challenges come from the shared
 * heartbeat (app/lib/liveChallenges.ts), refreshed again on each open. What
 * you haven't seen pops up under the bell until you act on it or dismiss it:
 * a round waiting for you to join (your challenge was accepted) first, else
 * the newest challenge sent to you. The popover stays mounted while closed.
 */

// Seen-list key for "your challenge was accepted", apart from the challenge's own id.
const acceptedKey = (id: string) => `accepted:${id}`;
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const seen = useSeenNotifications();
  const seenIds = seen.ids;
  const { challenges, accepted, answers } = useLiveChallenges();
  // Answered challenges linger until the next heartbeat; they aren't news.
  const live = challenges.filter((challenge) => !answers[challenge.id]);
  const ids = [...accepted.map((round) => acceptedKey(round.id)), ...live.map((challenge) => challenge.id)];
  const unseen = seenIds === null ? 0 : ids.filter((id) => !seenIds.includes(id)).length;
  // Newest first, so these are the latest unseen. Null on the server (seenIds), so they appear after hydration.
  const showPopup = !open && seenIds !== null;
  const joinPopup = showPopup ? accepted.find((round) => !seenIds.includes(acceptedKey(round.id))) : undefined;
  const popup = showPopup && !joinPopup ? live.find((challenge) => !seenIds.includes(challenge.id)) : undefined;

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
      void heartbeat();
    }
    setOpen(!open);
  };

  const dismissPopup = (id: string) => seen.markSeen([...(seenIds ?? []), id]);

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
      {/* Always mounted so screen readers hear the popup when it appears. */}
      <div className="challenge-popup-slot" aria-live="polite">
        {joinPopup && (
          <section key={acceptedKey(joinPopup.id)} className="challenge-popup" aria-label="Challenge accepted">
            <div className="challenge-popup-head">
              <span className="eyebrow">
                <ArenaIcon />
                Challenge accepted
              </span>
              <button type="button" className="challenge-popup-close" aria-label="Dismiss" onClick={() => dismissPopup(acceptedKey(joinPopup.id))}>
                ×
              </button>
            </div>
            <ul className="feed-notif-list">
              <AcceptedRow accepted={joinPopup} onJoin={() => dismissPopup(acceptedKey(joinPopup.id))} />
            </ul>
          </section>
        )}
        {popup && (
          <section key={popup.id} className="challenge-popup" aria-label="New challenge">
            <div className="challenge-popup-head">
              <span className="eyebrow">
                <ArenaIcon />
                New challenge
              </span>
              <button type="button" className="challenge-popup-close" aria-label="Dismiss" onClick={() => dismissPopup(popup.id)}>
                ×
              </button>
            </div>
            <ul className="feed-notif-list">
              <ChallengeRow request={popup} expanded />
            </ul>
          </section>
        )}
      </div>
      <div id={popoverId} className="notif-popover" role="dialog" aria-label="Notifications" hidden={!open} onClick={closeOnLink}>
        <FeedNotifications challenges={challenges} accepted={accepted} onAccepted={() => setOpen(false)} />
      </div>
    </div>
  );
}
