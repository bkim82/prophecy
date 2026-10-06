"use client";

import { useState } from "react";
import { ArenaIcon, NotInterestedIcon } from "@/app/icons";
import type { Topic, TopicId } from "@/app/lib/topics";

// Overflow menu for the post header — keeps Challenge (not a real handler
// yet, see docs/feeds.md) off the main actions row so it isn't the loudest
// thing on the card. On the For You feed it also lists "Not interested in …"
// for each of the post's topics.
export function PostMenu({
  firstName,
  topics = [],
  onNotInterested,
}: {
  firstName: string;
  topics?: Topic[];
  onNotInterested?: (id: TopicId) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="post-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="post-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Post actions"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="post-menu-dropdown" role="menu">
          <button type="button" role="menuitem" onClick={() => setOpen(false)}>
            <ArenaIcon /> Challenge {firstName}
          </button>
          {onNotInterested &&
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
