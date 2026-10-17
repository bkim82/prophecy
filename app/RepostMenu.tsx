"use client";

import { useRef, useState } from "react";
import type { Post } from "@/app/lib/mockPosts";
import { RepostIcon } from "@/app/icons";
import { RESHARE, RESHARE_KINDS, type Reshare, type ReshareKind } from "@/app/PostShare";

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (n: number) => compactCount.format(n).toLowerCase();

const MAX_WORDS = 280;

// Option hints once the box has words in it.
const WITH_WORDS_HINT: Record<ReshareKind, string> = {
  repost: "Share it with your take",
  vouch: "Back it, with your take",
  defy: "Go against it, with your take",
};

const LOCKED_HINT: Record<ReshareKind, string> = {
  repost: "",
  vouch: "You can't vouch for your own omen",
  defy: "You can't defy your own omen",
};

// You can repost your own post, but not vouch for or defy it.
const lockedFor = (mine: boolean, kind: ReshareKind) => mine && kind !== "repost";

// The action row's one repost button. It opens a popover with an optional
// "Add your words" box on top and Repost / Vouch / Defy under it: each option
// posts in one tap, carrying whatever is in the box (nothing = a bare
// repost). The active option reads "Undo …", or "Update …" once you've
// changed your words; picking another switches and keeps them. The draft
// survives closing the popover. The button shows the total of all three and
// takes the chosen kind's icon + color once you've reposted.
export function RepostMenu({
  post,
  mine,
  reshare,
  onChange,
}: {
  post: Post;
  mine: boolean;
  reshare: Reshare | null;
  onChange: (next: Reshare | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(reshare?.text ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const counts: Record<ReshareKind, number> = {
    repost: (post.reposts ?? 0) + (reshare?.kind === "repost" ? 1 : 0),
    vouch: (post.vouches ?? 0) + (reshare?.kind === "vouch" ? 1 : 0),
    defy: (post.defies ?? 0) + (reshare?.kind === "defy" ? 1 : 0),
  };
  const total = counts.repost + counts.vouch + counts.defy;
  const active = reshare && RESHARE[reshare.kind];
  const TriggerIcon = active ? active.Icon : RepostIcon;
  const words = draft.trim();
  const wordsChanged = words !== (reshare?.text ?? "");

  // Focus goes back to the trigger first so it isn't lost when the popover
  // unmounts.
  function close() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  function pick(kind: ReshareKind) {
    if (lockedFor(mine, kind)) return;
    const next = reshare?.kind === kind && !wordsChanged ? null : { kind, text: words };
    onChange(next);
    setDraft(next?.text ?? "");
    close();
  }

  return (
    <div
      className="repost-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`action-repost${reshare ? " is-active" : ""}`}
        data-kind={reshare?.kind}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active ? `${active.done} (${total}): change or undo` : `Repost (${total}): repost, vouch or defy`}
        title="Repost, vouch or defy"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <TriggerIcon />
        <span className="action-label">{active ? active.done : "Repost"}</span>
        {compact(total)}
      </button>
      {open && (
        <div className="repost-menu-dropdown" role="dialog" aria-label="Repost">
          <div className="repost-words">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add your words (optional)…"
              aria-label="Your words (optional), posted with whichever option you pick"
              maxLength={MAX_WORDS}
              rows={2}
            />
            {draft && (
              <span className="repost-words-count" aria-hidden="true">
                {draft.length}/{MAX_WORDS}
              </span>
            )}
          </div>
          <div role="menu" aria-label="Repost as">
            {RESHARE_KINDS.map((kind) => {
              const { label, hint, Icon } = RESHARE[kind];
              const current = reshare?.kind === kind;
              const locked = lockedFor(mine, kind);
              const title = current ? `${wordsChanged ? "Update" : "Undo"} ${label.toLowerCase()}` : label;
              const sub = locked
                ? LOCKED_HINT[kind]
                : current
                  ? wordsChanged
                    ? "Save your new words"
                    : "Take it off your followers' feeds"
                  : words
                    ? WITH_WORDS_HINT[kind]
                    : hint;
              return (
                <button key={kind} type="button" role="menuitem" className="repost-option" data-kind={kind} disabled={locked} onClick={() => pick(kind)}>
                  <Icon />
                  <span className="repost-option-text">
                    <strong>{title}</strong>
                    <span>{sub}</span>
                  </span>
                  {counts[kind] > 0 && <span className="repost-option-count">{compact(counts[kind])}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
