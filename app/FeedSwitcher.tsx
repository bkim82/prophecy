"use client";

import { useMemo, useState } from "react";
import { PostCard } from "@/app/PostCard";
import { FOLLOWED_HANDLES, type Post } from "@/app/lib/mockPosts";

type FilterId = "forYou" | "following" | "live";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "forYou", label: "For You" },
  { id: "following", label: "Following" },
  { id: "live", label: "Live Calls" },
];

export function FeedSwitcher({ posts }: { posts: Post[] }) {
  const [filter, setFilter] = useState<FilterId>("forYou");

  const visible = useMemo(() => {
    if (filter === "following") return posts.filter((post) => FOLLOWED_HANDLES.includes(post.handle));
    if (filter === "live") return posts.filter((post) => post.kind === "call");
    return posts;
  }, [filter, posts]);

  return (
    <>
      <div className="feed-tabs" role="tablist" aria-label="Feed filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={filter === f.id ? "active" : ""}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="feed-list">
        {visible.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {visible.length === 0 && <p className="muted feed-empty">Nothing here yet.</p>}
      </div>
    </>
  );
}
