"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BackIcon } from "@/app/icons";
import type { Post, Reply } from "@/app/lib/posts";
import { useTopicSignal } from "@/app/lib/topicSignals";
import { PostCard } from "@/app/PostCard";
import { ReplyBranch, ReplyComposer, threadReplies } from "@/app/PostReplies";

// `replies` = saved, newest first (lib/engagement.ts repliesFor), each
// comment with every reply under it (ReplyBranch: a reply's Reply button
// opens a box under its comment). Replies you post here are saved — comments
// on top — and ones you delete drop out (both move the comment count).
export function PostThread({ post, replies }: { post: Post; replies: Reply[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useState<Reply[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const groups = threadReplies([...mine, ...replies].filter((reply) => !removed.includes(reply.id)));
  // Opening a post and replying to it count toward inferred interests
  // (once per post; the server skips your own).
  const signal = useTopicSignal();
  useEffect(() => signal("open_post", { postId: post.id }), [signal, post.id]);

  // Back to wherever the post was opened from; a fresh tab has nowhere to go
  // back to, so it lands on the feed.
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  function addReply(reply: Reply) {
    signal("reply", { postId: post.id });
    setMine((current) => [reply, ...current]);
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
          blocked={post.blocked}
          postId={post.id}
          replyingTo={post.handle || post.author}
          inputRef={inputRef}
          draft={draft}
          onDraft={setDraft}
          onPosted={addReply}
        />
        <div className="post-replies">
          {groups.map((group) => (
            <ReplyBranch
              key={group.comment.id}
              group={group}
              postId={post.id}
              blocked={post.blocked}
              onPosted={addReply}
              onDeleted={({ id }) => setRemoved((current) => [...current, id])}
            />
          ))}
          {groups.length === 0 && <p className="muted post-replies-empty">No replies yet. Be the first.</p>}
        </div>
      </div>
    </section>
  );
}
