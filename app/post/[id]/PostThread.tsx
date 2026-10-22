"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BackIcon } from "@/app/icons";
import type { Post, Reply } from "@/app/lib/mockPosts";
import { PostCard } from "@/app/PostCard";
import { ReplyComposer, ReplyItem, withMention } from "@/app/PostReplies";

// `replies` = saved then mock (lib/engagement.ts repliesFor). Replies you post
// here are saved and go on top, ones you delete drop out (both move the
// comment count); a reply's Reply button @mentions its author in the box.
export function PostThread({ post, replies }: { post: Post; replies: Reply[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useState<Reply[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const all = [...mine, ...replies].filter((reply) => !removed.includes(reply.id));

  // Back to wherever the post was opened from; a fresh tab has nowhere to go
  // back to, so it lands on the feed.
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  function mention(reply: Reply) {
    setDraft((current) => withMention(current, reply.handle));
    inputRef.current?.focus();
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
        <PostCard post={{ ...post, replies: post.replies + mine.length - removed.length }} detail onReply={() => inputRef.current?.focus()} />
        <ReplyComposer
          postId={post.id}
          replyingTo={post.handle || post.author}
          inputRef={inputRef}
          draft={draft}
          onDraft={setDraft}
          onPosted={(reply) => setMine((current) => [reply, ...current])}
        />
        <div className="post-replies">
          {all.map((reply) => (
            <ReplyItem
              key={reply.id}
              reply={reply}
              postId={post.id}
              onReply={mention}
              onDeleted={({ id }) => setRemoved((current) => [...current, id])}
            />
          ))}
          {all.length === 0 && <p className="muted post-replies-empty">No replies yet. Be the first.</p>}
        </div>
      </div>
    </section>
  );
}
