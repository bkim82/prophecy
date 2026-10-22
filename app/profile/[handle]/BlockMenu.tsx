"use client";

import { useId, useRef, useState, useTransition } from "react";
import { blockProfile } from "@/app/profile/actions";

// Block / Unblock on a real account's profile hero (app/profile/[handle]/ProfileView.tsx).
// blockProfile (app/profile/actions.ts) refreshes the page with the new
// state; `onSaved` lets the hero drop its optimistic Follow at once.

function useSaveBlock(handle: string, onSaved?: (blocked: boolean) => void) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (blocked: boolean, then?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await blockProfile(handle, blocked).catch(() => ({ ok: false as const, error: "Couldn't save that — try again." }));
      if (!result.ok) return setError(result.error);
      onSaved?.(blocked);
      then?.();
    });
  return { save, pending, error };
}

// The ⋯ menu beside Follow. Block asks once more in place, like Delete post
// in app/PostMenu.tsx; for someone you've blocked it offers Unblock.
export function BlockMenu({ handle, blocked, onSaved }: { handle: string; blocked: boolean; onSaved?: (blocked: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const { save, pending, error } = useSaveBlock(handle, onSaved);

  function close() {
    triggerRef.current?.focus();
    setOpen(false);
    setConfirming(false);
  }

  return (
    <div
      className="post-menu profile-more"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setOpen(false);
        setConfirming(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="post-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className="post-menu-dropdown" role="menu">
          {confirming && (
            <p id={confirmId} className="post-menu-confirm" role="none">
              <strong>Block {handle}?</strong> They won&rsquo;t be able to follow or message you, you&rsquo;ll unfollow each other, and you won&rsquo;t
              see their posts in your feed.
            </p>
          )}
          {blocked ? (
            <button type="button" role="menuitem" disabled={pending} onClick={() => save(false, close)}>
              {pending ? "Unblocking…" : `Unblock ${handle}`}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className={`post-menu-delete${confirming ? " is-confirming" : ""}`}
              aria-describedby={confirming ? confirmId : undefined}
              disabled={pending}
              onClick={() => (confirming ? save(true, close) : setConfirming(true))}
            >
              {pending ? "Blocking…" : confirming ? "Block" : `Block ${handle}`}
            </button>
          )}
          {confirming && (
            <button type="button" role="menuitem" onClick={close}>
              Cancel
            </button>
          )}
          {error && (
            <p className="post-menu-confirm" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// In place of Follow while you have them blocked.
export function UnblockButton({ handle }: { handle: string }) {
  const { save, pending, error } = useSaveBlock(handle);
  return (
    <>
      <button type="button" className="profile-follow profile-unblock" disabled={pending} onClick={() => save(false)}>
        {pending ? "Unblocking…" : "Unblock"}
      </button>
      {error && (
        <p className="profile-edit-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
