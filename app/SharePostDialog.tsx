"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { SignInAction, useAppAuth } from "@/app/auth/AuthProvider";
import { CloseIcon, SearchIcon, SendIcon } from "@/app/icons";
import { MESSAGE_MAX_LENGTH, normalizeMessage, type Peer } from "@/app/lib/messageRules";
import { postMessage, showMessages, usePeople } from "@/app/lib/messages";
import type { Post } from "@/app/lib/posts";
import { PeerAvatar } from "@/app/MessagesDock";

// A post's Send button (app/PostCard.tsx, at the end of its actions) and the
// dialog it opens: pick people (friends first, or search), add a note if you
// like, and each gets the post as a direct message (POST /api/messages/thread
// with `postId`) — a card in the conversation (app/MessagesDock.tsx). Then
// the Messages dock opens on it, so you see it land.

const MAX_RECIPIENTS = 10;

export function SendPostButton({ post }: { post: Post }) {
  const { isSignedIn } = useAppAuth();
  const [open, setOpen] = useState(false);
  const button = (
    <button type="button" className="action-send" aria-label="Send in a message" title="Send in a message" onClick={() => isSignedIn && setOpen(true)}>
      <SendIcon />
    </button>
  );
  return (
    <>
      {isSignedIn ? button : <SignInAction>{button}</SignInAction>}
      {open && <SharePostDialog post={post} onClose={() => setOpen(false)} />}
    </>
  );
}

function SharePostDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const found = usePeople(query);
  const [picked, setPicked] = useState<Peer[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const isPicked = (peer: Peer) => picked.some((other) => other.handle === peer.handle);
  const toggle = (peer: Peer) =>
    setPicked((current) =>
      current.some((other) => other.handle === peer.handle)
        ? current.filter((other) => other.handle !== peer.handle)
        : current.length >= MAX_RECIPIENTS
          ? current
          : [...current, peer],
    );

  const send = () => {
    if (picked.length === 0 || pending) return;
    startTransition(async () => {
      setError(null);
      const body = normalizeMessage(note);
      const results = await Promise.all(picked.map((peer) => postMessage({ handle: peer.handle, postId: post.id, body })));
      const failed = picked.filter((_, index) => !results[index].ok);
      if (failed.length === 0) {
        dialogRef.current?.close();
        showMessages(picked.length === 1 ? { kind: "thread", peer: picked[0] } : { kind: "list", folder: "inbox" });
        return;
      }
      const reason = results.flatMap((result) => (result.ok ? [] : [result.error]))[0];
      // Keep only who it didn't reach, so Send again retries just them.
      setPicked(failed);
      setError(failed.length === results.length ? reason : `Sent to ${results.length - failed.length}. Not sent to ${failed.map((peer) => peer.handle).join(", ")}: ${reason}`);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      className="profile-edit share-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => pending && event.preventDefault()}
      // Rendered inside the post card, whose clicks open the post.
      onClick={(event) => event.stopPropagation()}
    >
      <form
        className="profile-edit-panel"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <header className="profile-edit-head">
          <h2 id={`${id}-title`}>Send post</h2>
          <button type="button" className="profile-edit-close" aria-label="Close" disabled={pending} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>

        <div className="profile-edit-body share-body">
          <p className="share-preview">
            <strong>{post.author}</strong>
            {post.handle && <span className="muted"> {post.handle}</span>}
            {post.content && <span className="share-preview-text">{post.content}</span>}
          </p>

          <label className="messages-search share-search">
            <SearchIcon />
            <span className="sr-only">Search people</span>
            <input type="search" value={query} placeholder="Search by name or @handle" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          </label>

          {picked.length > 0 && (
            <ul className="share-picked" aria-label="Sending to">
              {picked.map((peer) => (
                <li key={peer.handle}>
                  <PeerAvatar peer={peer} small />
                  {peer.name}
                  <button type="button" aria-label={`Don't send to ${peer.name}`} disabled={pending} onClick={() => toggle(peer)}>
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="share-people">
            {!found ? (
              <p className="share-empty">Loading…</p>
            ) : !found.people ? (
              <p className="share-empty" role="alert">
                Couldn&rsquo;t search right now — try again in a moment.
              </p>
            ) : found.people.length === 0 ? (
              <p className="share-empty">
                {found.query ? `No one matches “${found.query}”.` : "Friends (you follow each other) show up here — or search for anyone by name or @handle."}
              </p>
            ) : (
              <>
                {!found.query && <p className="messages-section">Friends</p>}
                <ul className="messages-list">
                  {found.people.map((peer) => (
                    <li key={peer.handle}>
                      <button type="button" className="messages-row share-person" aria-pressed={isPicked(peer)} disabled={pending} onClick={() => toggle(peer)}>
                        <PeerAvatar peer={peer} />
                        <span className="messages-row-body">
                          <span className="messages-row-top">
                            <strong>{peer.name}</strong>
                          </span>
                          <span className="messages-row-preview">{peer.handle}</span>
                        </span>
                        <span className="share-check" aria-hidden="true">
                          {isPicked(peer) ? "✓" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <textarea
            className="share-note"
            rows={2}
            value={note}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Add a message (optional)"
            aria-label="Add a message"
            onChange={(event) => setNote(event.target.value)}
          />

          {error && (
            <p className="profile-edit-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="profile-edit-foot">
          <div className="profile-edit-buttons">
            <button type="button" className="profile-follow is-following" disabled={pending} onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="profile-follow share-send" disabled={pending || picked.length === 0}>
              <SendIcon />
              {pending ? "Sending…" : picked.length > 1 ? `Send to ${picked.length}` : "Send"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
