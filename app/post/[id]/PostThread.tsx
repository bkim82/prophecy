"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { BackIcon } from "@/app/icons";
import type { Post, Reply } from "@/app/lib/mockPosts";
import { markViewed } from "@/app/lib/postLists";
import { PostCard, ReplyItem } from "@/app/PostCard";

// Local-only, like the feed composer: a reply is prepended to this page's
// list and gone on reload. Authorship uses the signed-in Clerk user's name.
function ReplyComposer({
  inputRef,
  replyingTo,
  onReply,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  replyingTo: string;
  onReply: (reply: Reply) => void;
}) {
  const { user } = useUser();
  const [text, setText] = useState("");
  const name = user?.firstName ?? user?.username ?? "You";
  const initial = name[0].toUpperCase();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if (!content) return;
    onReply({ id: `local-reply-${Date.now()}`, author: name, handle: `@${user?.username ?? "you"}`, avatarInitial: initial, content, timestamp: "now", likes: 0 });
    setText("");
  }

  return (
    <form className="feed-composer reply-composer" onSubmit={submit}>
      <span className="feed-composer-avatar" aria-hidden="true">
        {initial}
      </span>
      <label className="reply-composer-field">
        <span className="muted">Replying to {replyingTo}</span>
        <input
          ref={inputRef}
          className="feed-composer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Post your reply"
          maxLength={280}
        />
      </label>
      <button type="submit" className="feed-composer-post" disabled={!text.trim()}>
        Reply
      </button>
    </form>
  );
}

export function PostThread({ post, replies }: { post: Post; replies: Reply[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mine, setMine] = useState<Reply[]>([]);
  const all = [...mine, ...replies];

  // Opening a post counts as reading it (feed rail's Recently viewed).
  useEffect(() => {
    markViewed(post.id);
  }, [post.id]);

  // Back to wherever the post was opened from; a fresh tab has nowhere to go
  // back to, so it lands on the feed.
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <section className="post-thread" aria-label={`Post by ${post.author}`}>
      <div className="post-thread-head">
        <button type="button" className="post-thread-back" aria-label="Back" onClick={goBack}>
          <BackIcon />
        </button>
        <h1>Post</h1>
      </div>
      <div className="feed-panel">
        <PostCard post={post} detail onReply={() => inputRef.current?.focus()} />
        <ReplyComposer inputRef={inputRef} replyingTo={post.handle} onReply={(reply) => setMine((current) => [reply, ...current])} />
        <div className="post-replies">
          {all.map((reply) => (
            <ReplyItem key={reply.id} reply={reply} />
          ))}
          {all.length === 0 && <p className="muted post-replies-empty">No replies yet. Be the first.</p>}
        </div>
      </div>
    </section>
  );
}
