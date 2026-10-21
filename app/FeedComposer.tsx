"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { markFreshPost } from "@/app/lib/freshPost";
import { publishPost } from "@/app/lib/postApi";

// Quick text-only composer on the feed: Post saves through POST /api/posts
// and re-renders the feed so it shows up on top (signed out, Post opens sign
// in). "+ Trade" hands what you've typed to the full composer at /compose
// with its trade picker open.
export function FeedComposer() {
  const router = useRouter();
  const { user, isSignedIn, openSignIn } = useAppAuth();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = user?.firstName ?? user?.username ?? "You";
  const initial = name[0].toUpperCase();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = text.trim();
    if (!content || posting) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setPosting(true);
    setError(null);
    const result = await publishPost({ content });
    setPosting(false);
    if (!result.ok) {
      setError(result.error);
      if (result.status === 401) openSignIn();
      return;
    }
    setText("");
    markFreshPost(result.id);
    router.refresh();
  }

  return (
    <>
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
          aria-describedby={error ? "feed-composer-error" : undefined}
          maxLength={280}
        />
        <Link href={{ pathname: "/compose", query: { attach: "trade", ...(text.trim() && { text }) } }} className="feed-composer-trade">
          + Trade
        </Link>
        <button type="submit" className="feed-composer-post" disabled={!text.trim() || posting}>
          {posting ? "Posting…" : "Post"}
        </button>
      </form>
      {error && (
        <p className="feed-composer-error" id="feed-composer-error" role="status">
          {error}
        </p>
      )}
    </>
  );
}
