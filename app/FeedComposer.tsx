"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import type { Post } from "@/app/lib/mockPosts";

// Local-only composer: Post prepends a plain take to this tab's feed — no
// backend, gone on reload (docs/roadmap.md "Post composer"). Authorship uses
// the signed-in Clerk user's name when there is one.
export function FeedComposer({ onPost }: { onPost: (post: Post) => void }) {
  const { user } = useUser();
  const [text, setText] = useState("");
  const name = user?.firstName ?? user?.username ?? "You";
  const handle = `@${user?.username ?? "you"}`;
  const initial = name[0].toUpperCase();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if (!content) return;
    onPost({ id: `local-${Date.now()}`, author: name, handle, avatarInitial: initial, content, timestamp: "now", likes: 0, replies: 0, kind: "text", mine: true });
    setText("");
  }

  return (
    <form className="feed-composer" onSubmit={submit}>
      <span className="feed-composer-avatar" aria-hidden="true">
        {initial}
      </span>
      <input
        className="feed-composer-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What's the market telling you?"
        aria-label="Write a post"
        maxLength={280}
      />
      <Link href="/duel" className="feed-composer-trade">
        + Trade
      </Link>
      <button type="submit" className="feed-composer-post" disabled={!text.trim()}>
        Post
      </button>
    </form>
  );
}
