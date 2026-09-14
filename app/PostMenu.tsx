"use client";

import { useState } from "react";
import { DuelIcon } from "@/app/icons";

// Overflow menu for the post header — keeps Challenge (not a real handler
// yet, see docs/feeds.md) off the main actions row so it isn't the loudest
// thing on the card.
export function PostMenu({ firstName }: { firstName: string }) {
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
            <DuelIcon /> Challenge {firstName}
          </button>
        </div>
      )}
    </div>
  );
}
