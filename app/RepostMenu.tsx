"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { avatarGradient } from "@/app/lib/avatar";
import type { Post } from "@/app/lib/mockPosts";
import { PenIcon, RepostIcon } from "@/app/icons";
import { RESHARE, RESHARE_KINDS, type Reshare, type ReshareKind } from "@/app/PostShare";

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (n: number) => compactCount.format(n).toLowerCase();

const MAX_WORDS = 280;

const PLACEHOLDER: Record<ReshareKind, string> = {
  repost: "Add your take…",
  vouch: "Why do you back it?",
  defy: "Why are you against it?",
};

const LOCKED_HINT: Record<ReshareKind, string> = {
  repost: "",
  vouch: "You can't vouch for your own omen",
  defy: "You can't defy your own omen",
};

// You can repost your own post, but not vouch for or defy it.
const lockedFor = (mine: boolean, kind: ReshareKind) => mine && kind !== "repost";

// The action row's one repost button. It opens a menu: Repost / Vouch / Defy
// share in one tap (the active one reads "Undo …"; picking another switches
// and keeps your words), and "Add your words" opens RepostDialog to write a
// take on top of any of the three. The button shows the total of all three
// and takes the chosen kind's icon + color once you've reposted.
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
  const [composing, setComposing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const counts: Record<ReshareKind, number> = {
    repost: (post.reposts ?? 0) + (reshare?.kind === "repost" ? 1 : 0),
    vouch: (post.vouches ?? 0) + (reshare?.kind === "vouch" ? 1 : 0),
    defy: (post.defies ?? 0) + (reshare?.kind === "defy" ? 1 : 0),
  };
  const total = counts.repost + counts.vouch + counts.defy;
  const active = reshare && RESHARE[reshare.kind];
  const TriggerIcon = active ? active.Icon : RepostIcon;

  // Focus goes back to the trigger first so it isn't lost when the menu
  // item unmounts (and the dialog returns focus there when it closes).
  function close() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  function pick(kind: ReshareKind) {
    close();
    if (lockedFor(mine, kind)) return;
    onChange(reshare?.kind === kind ? null : { kind, text: reshare?.text ?? "" });
  }

  return (
    <div
      className="repost-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`action-repost${reshare ? " is-active" : ""}`}
        data-kind={reshare?.kind}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active ? `${active.done} (${total}): change or undo` : `Repost (${total}): repost, vouch or defy`}
        title="Repost, vouch or defy"
        onClick={() => setOpen((value) => !value)}
      >
        <TriggerIcon />
        <span className="action-label">{active ? active.done : "Repost"}</span>
        {compact(total)}
      </button>
      {open && (
        <div className="repost-menu-dropdown" role="menu" aria-label="Repost options">
          {RESHARE_KINDS.map((kind) => {
            const { label, hint, Icon } = RESHARE[kind];
            const current = reshare?.kind === kind;
            const locked = lockedFor(mine, kind);
            return (
              <button key={kind} type="button" role="menuitem" className="repost-option" data-kind={kind} disabled={locked} onClick={() => pick(kind)}>
                <Icon />
                <span className="repost-option-text">
                  <strong>{current ? `Undo ${label.toLowerCase()}` : label}</strong>
                  <span>{locked ? LOCKED_HINT[kind] : current ? "Take it off your followers' feeds" : hint}</span>
                </span>
                {counts[kind] > 0 && <span className="repost-option-count">{compact(counts[kind])}</span>}
              </button>
            );
          })}
          <span className="repost-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="repost-option repost-option--words"
            onClick={() => {
              close();
              setComposing(true);
            }}
          >
            <PenIcon />
            <span className="repost-option-text">
              <strong>{reshare?.text ? "Edit your words" : "Add your words"}</strong>
              <span>{mine ? "Repost it with your take" : "Repost, vouch or defy with your take"}</span>
            </span>
          </button>
        </div>
      )}
      {composing && <RepostDialog post={post} mine={mine} initial={reshare} onSubmit={onChange} onClose={() => setComposing(false)} />}
    </div>
  );
}

// Quote composer: pick Repost / Vouch / Defy, write your words (optional, up
// to 280), see the post you're quoting under them. A native modal <dialog>
// (top layer, focus trap, Esc) in the Edit profile shell (.profile-edit*),
// portaled to <body> so the feed row's styles and click-to-open don't reach it.
function RepostDialog({
  post,
  mine,
  initial,
  onSubmit,
  onClose,
}: {
  post: Post;
  mine: boolean;
  initial: Reshare | null;
  onSubmit: (reshare: Reshare) => void;
  onClose: () => void;
}) {
  const { user } = useUser();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<ReshareKind>(initial?.kind ?? "repost");
  const [text, setText] = useState(initial?.text ?? "");
  const name = user?.firstName ?? user?.username ?? "You";

  useEffect(() => {
    dialogRef.current?.showModal();
    const field = textRef.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="profile-edit repost-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form
        className="profile-edit-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ kind, text: text.trim() });
          dialogRef.current?.close();
        }}
      >
        <header className="profile-edit-head">
          <h2 id={`${id}-title`}>Add your words</h2>
          <button type="button" className="profile-edit-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        <div className="profile-edit-body">
          <fieldset className="repost-kinds">
            <legend>Repost as</legend>
            <div className="repost-kinds-row">
              {RESHARE_KINDS.map((option) => {
                const { label, Icon } = RESHARE[option];
                return (
                  <label key={option} className="repost-kind" data-kind={option}>
                    <input
                      type="radio"
                      name={`${id}-kind`}
                      value={option}
                      checked={kind === option}
                      disabled={lockedFor(mine, option)}
                      onChange={() => setKind(option)}
                    />
                    <Icon />
                    {label}
                  </label>
                );
              })}
            </div>
            <p className="repost-kinds-hint">{mine ? "You can't vouch for or defy your own omen" : RESHARE[kind].hint}.</p>
          </fieldset>
          <div className="repost-compose">
            <span className="feed-composer-avatar" aria-hidden="true">
              {name[0].toUpperCase()}
            </span>
            <textarea
              ref={textRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={PLACEHOLDER[kind]}
              aria-label="Your words (optional)"
              maxLength={MAX_WORDS}
              rows={3}
            />
          </div>
          <div className="repost-quote">
            <span className="repost-quote-avatar" aria-hidden="true" style={{ background: avatarGradient(post.handle) }}>
              {post.avatarInitial}
            </span>
            <div className="repost-quote-body">
              <p className="repost-quote-meta">
                <strong>{post.author}</strong> <span className="muted">{post.handle} · {post.timestamp}</span>
              </p>
              <p className="repost-quote-text">{post.content}</p>
            </div>
          </div>
        </div>
        <footer className="profile-edit-foot">
          <span className="repost-dialog-count muted" aria-hidden="true">
            {text.length}/{MAX_WORDS}
          </span>
          <div className="profile-edit-buttons">
            <button type="button" className="profile-follow is-following" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="profile-follow repost-dialog-submit" data-kind={kind}>
              {RESHARE[kind].label}
            </button>
          </div>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
