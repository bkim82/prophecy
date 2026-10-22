"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { HeartIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { deleteReply, editReply, loadReplies, publishReply, saveReplyLike, useSaved } from "@/app/lib/engagementApi";
import type { Post, Reply } from "@/app/lib/mockPosts";

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (n: number) => compactCount.format(n).toLowerCase();

const REPLIES_SHOWN_INITIALLY = 2;

// A reply's Reply button puts "@handle " in front of the draft, once.
export const withMention = (draft: string, handle: string) =>
  !handle || draft.split(/\s+/).includes(handle) ? draft : `${handle} ${draft}`;

// Edits your own reply in place: Save (Enter) keeps the new words, Cancel
// (Esc) or unchanged words leave it as it was.
function ReplyEditor({
  postId,
  replyId,
  initial,
  onSaved,
  onCancel,
}: {
  postId: string;
  replyId: string;
  initial: string;
  onSaved: (content: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if (!content || saving) return;
    if (content === initial) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await editReply(postId, replyId, content);
    setSaving(false);
    if (result.ok) onSaved(result.content);
    else setError(result.error);
  }

  return (
    <form
      className="reply-edit"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <input
        ref={inputRef}
        className="reply-edit-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Edit your reply"
        maxLength={280}
      />
      <div className="reply-actions">
        <button type="submit" className="action-reply reply-save" disabled={!text.trim() || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="action-reply" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="reply-error" role="status">
          {error}
        </p>
      )}
    </form>
  );
}

// One reply: like (saved, lib/engagement.ts) and Reply, which hands the reply
// to `onReply` so the reply box can @mention its author. Your own saved
// replies (`reply.mine`) add Edit (in place, then "· edited") and Delete
// (asks once more in the row, then `onDeleted` drops it from the list). The
// name links to the author's profile (yours: /profile).
export function ReplyItem({
  reply,
  postId,
  onReply,
  onDeleted,
}: {
  reply: Reply;
  postId: string;
  onReply: (reply: Reply) => void;
  onDeleted: (reply: Reply) => void;
}) {
  const [liked, setLiked] = useSaved(reply.liked === true, (next) => saveReplyLike(postId, reply.id, next));
  const likes = reply.likes - (reply.liked ? 1 : 0) + (liked ? 1 : 0);
  const [content, setContent] = useState(reply.content);
  const [edited, setEdited] = useState(reply.edited === true);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const ok = await deleteReply(postId, reply.id);
    setDeleting(false);
    if (ok) {
      onDeleted(reply);
      return;
    }
    setConfirming(false);
    setError("Couldn't delete your reply. Try again.");
  }

  return (
    <div className="reply-item">
      <div className="reply-avatar" aria-hidden="true" style={{ background: avatarGradient(reply.handle || reply.author) }}>
        {reply.avatarInitial}
      </div>
      <div className="reply-body">
        <div className="reply-meta">
          <AuthorLink handle={reply.handle} name={reply.author} account={reply.saved} href={reply.mine ? "/profile" : undefined} />
          <span className="muted">{reply.handle}</span>
          <span className="muted">· {reply.timestamp}</span>
          {edited && <span className="muted">· edited</span>}
        </div>
        {editing ? (
          <ReplyEditor
            postId={postId}
            replyId={reply.id}
            initial={content}
            onSaved={(next) => {
              setContent(next);
              setEdited(true);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="reply-content">{content}</p>
            <div className="reply-actions">
              <button
                type="button"
                className={`action-like${liked ? " is-active" : ""}`}
                aria-pressed={liked}
                aria-label={`Like (${likes})`}
                onClick={() => setLiked(!liked)}
              >
                <HeartIcon filled={liked} /> {compact(likes)}
              </button>
              <button type="button" className="action-reply" onClick={() => onReply(reply)}>
                Reply
              </button>
              {reply.mine &&
                (confirming ? (
                  <>
                    <span className="reply-confirm">Delete this reply?</span>
                    <button type="button" className="action-reply reply-delete is-confirming" disabled={deleting} onClick={() => void remove()}>
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                    <button type="button" className="action-reply" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="action-reply" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                    <button type="button" className="action-reply reply-delete" onClick={() => setConfirming(true)}>
                      Delete
                    </button>
                  </>
                ))}
            </div>
            {error && (
              <p className="reply-error" role="status">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// The reply box: full width on the post page ("Replying to @x" over the
// field), `inline` at the top of a feed post's thread. The parent owns
// `draft` so a reply's Reply button can @mention into it. Saves through
// POST /api/posts/[id]/replies; signed out, Reply opens sign-in and keeps the
// draft. Authorship is server-derived; the avatar initial here is the
// signed-in user's. `blocked` (a block either way with the post's author,
// `post.blocked`) swaps the box for a note — the server refuses anyway.
export function ReplyComposer({
  postId,
  replyingTo,
  inputRef,
  draft,
  onDraft,
  onPosted,
  inline = false,
  blocked = false,
}: {
  postId: string;
  replyingTo: string;
  inputRef: RefObject<HTMLInputElement | null>;
  draft: string;
  onDraft: (draft: string) => void;
  onPosted: (reply: Reply) => void;
  inline?: boolean;
  blocked?: boolean;
}) {
  const { user, isSignedIn, openSignIn } = useAppAuth();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = user?.firstName ?? user?.username ?? "You";
  const initial = name[0].toUpperCase();
  const errorId = `reply-error-${postId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || posting) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setPosting(true);
    setError(null);
    const result = await publishReply(postId, content);
    setPosting(false);
    if (!result.ok) {
      setError(result.error);
      if (result.status === 401) openSignIn();
      return;
    }
    onDraft("");
    onPosted(result.reply);
  }

  if (blocked) return <p className="muted reply-blocked">You can&rsquo;t reply to this post.</p>;

  return (
    <>
      <form className={`feed-composer reply-composer${inline ? " reply-composer--inline" : ""}`} onSubmit={submit}>
        <span className="feed-composer-avatar" aria-hidden="true">
          {initial}
        </span>
        <label className="reply-composer-field">
          {!inline && <span className="muted">Replying to {replyingTo}</span>}
          <input
            ref={inputRef}
            className="feed-composer-input"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder="Post your reply"
            aria-label={inline ? `Reply to ${replyingTo}` : undefined}
            aria-describedby={error ? errorId : undefined}
            maxLength={280}
          />
        </label>
        <button type="submit" className="feed-composer-post" disabled={!draft.trim() || posting}>
          {posting ? "Replying…" : "Reply"}
        </button>
      </form>
      {error && (
        <p className="feed-composer-error" id={errorId} role="status">
          {error}
        </p>
      )}
    </>
  );
}

// The comment action's thread under a feed post (expands in place, X/Reddit
// style): the reply box first, focused as it opens so you can type straight
// away, then the post's replies from GET /api/posts/[id]/replies — the first
// couple, "View N more" reveals the rest. Replies you post go on top; ones
// you delete drop out. `onCountChange` moves the card's comment count.
export function ReplyThread({ post, onCountChange }: { post: Post; onCountChange: (delta: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useState<Reply[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  // null while loading; "failed" offers a retry (`attempt` re-runs the load).
  const [loaded, setLoaded] = useState<Reply[] | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(REPLIES_SHOWN_INITIALLY);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadReplies(post.id).then((replies) => {
      if (!cancelled) setLoaded(replies ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [post.id, attempt]);

  function mention(reply: Reply) {
    setDraft((current) => withMention(current, reply.handle));
    inputRef.current?.focus();
  }

  function removeReply(reply: Reply) {
    setRemoved((current) => [...current, reply.id]);
    onCountChange(-1);
  }

  const kept = (reply: Reply) => !removed.includes(reply.id);
  const replies = (Array.isArray(loaded) ? loaded : []).filter(kept);
  const visible = [...mine.filter(kept), ...replies.slice(0, shown)];
  const remaining = replies.length - Math.min(shown, replies.length);

  return (
    <div className="reply-thread">
      <ReplyComposer
        inline
        blocked={post.blocked}
        postId={post.id}
        replyingTo={post.handle || post.author}
        inputRef={inputRef}
        draft={draft}
        onDraft={setDraft}
        onPosted={(reply) => {
          setMine((current) => [reply, ...current]);
          onCountChange(1);
        }}
      />
      {visible.map((reply) => (
        <ReplyItem key={reply.id} reply={reply} postId={post.id} onReply={mention} onDeleted={removeReply} />
      ))}
      {loaded === null ? (
        <p className="muted reply-thread-empty">Loading replies…</p>
      ) : loaded === "failed" ? (
        <p className="muted reply-thread-empty">
          Couldn&apos;t load replies.{" "}
          <button
            type="button"
            className="reply-thread-more"
            onClick={() => {
              setLoaded(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </p>
      ) : (
        visible.length === 0 && <p className="muted reply-thread-empty">No replies yet — be the first.</p>
      )}
      {remaining > 0 && (
        <button type="button" className="reply-thread-more" onClick={() => setShown((n) => n + remaining)}>
          View {remaining} more {remaining === 1 ? "reply" : "replies"}
        </button>
      )}
    </div>
  );
}
