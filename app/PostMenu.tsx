"use client";

import { useId, useRef, useState } from "react";
import { ArenaIcon, NotInterestedIcon, TrashIcon } from "@/app/icons";
import type { Topic, TopicId } from "@/app/lib/topics";

// Overflow menu for the post header — keeps Challenge (not a real handler
// yet, see docs/feeds.md) off the main actions row so it isn't the loudest
// thing on the card. On the For You feed it also lists "Not interested in …"
// for each of the post's topics. On your own post (`mine`) Challenge is gone
// and `onDelete` adds Delete post, which asks once more in place before it
// fires.
export function PostMenu({
  firstName,
  topics = [],
  onNotInterested,
  mine = false,
  onDelete,
}: {
  firstName: string;
  topics?: Topic[];
  onNotInterested?: (id: TopicId) => void;
  mine?: boolean;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();

  function close() {
    triggerRef.current?.focus();
    setOpen(false);
    setConfirming(false);
  }

  return (
    <div
      className="post-menu"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setOpen(false);
        setConfirming(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="post-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Post actions"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className="post-menu-dropdown" role="menu">
          {/* The Delete button keeps its slot while confirming, so it keeps focus
              and the menu doesn't blur shut under it. */}
          {confirming && (
            <p id={confirmId} className="post-menu-confirm" role="none">
              <strong>Delete this post?</strong> This can&apos;t be undone.
            </p>
          )}
          {!mine && (
            <button type="button" role="menuitem" onClick={() => setOpen(false)}>
              <ArenaIcon /> Challenge {firstName}
            </button>
          )}
          {mine && onDelete && (
            <button
              type="button"
              role="menuitem"
              className={`post-menu-delete${confirming ? " is-confirming" : ""}`}
              aria-describedby={confirming ? confirmId : undefined}
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
            >
              <TrashIcon /> {confirming ? "Delete" : "Delete post"}
            </button>
          )}
          {confirming && (
            <button type="button" role="menuitem" onClick={close}>
              Cancel
            </button>
          )}
          {onNotInterested &&
            !confirming &&
            topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNotInterested(topic.id);
                }}
              >
                <NotInterestedIcon /> Not interested in {topic.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
