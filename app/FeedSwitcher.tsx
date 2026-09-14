"use client";

import { useMemo, useState } from "react";
import { PostCard } from "@/app/PostCard";
import { FOLLOWED_HANDLES, type Market, type Post } from "@/app/lib/mockPosts";

type FilterId = "forYou" | "following" | "live";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "forYou", label: "For You" },
  { id: "following", label: "Following" },
  { id: "live", label: "Live Calls" },
];

type CommunityId = "all" | Market;

const COMMUNITIES: { id: CommunityId; label: string; symbol?: string; symbolClass?: string }[] = [
  { id: "all", label: "All" },
  { id: "btc", label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  { id: "eth", label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  { id: "doge", label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
];

export function FeedSwitcher({ posts }: { posts: Post[] }) {
  const [filter, setFilter] = useState<FilterId>("forYou");
  const [community, setCommunity] = useState<CommunityId>("all");
  const [communityOpen, setCommunityOpen] = useState(false);

  const visible = useMemo(() => {
    let result = posts;
    if (filter === "following") result = result.filter((post) => FOLLOWED_HANDLES.includes(post.handle));
    if (filter === "live") result = result.filter((post) => post.kind === "call");
    if (community !== "all") {
      result = result.filter((post) => (post.market ?? post.call?.market) === community);
    }
    return result;
  }, [filter, community, posts]);

  const activeCommunity = COMMUNITIES.find((c) => c.id === community)!;

  return (
    <>
      <section className="feed-heading">
        <div className="feed-heading-row">
          <h1 className="display-font">Feed</h1>
          <div
            className="community-dropdown"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setCommunityOpen(false);
            }}
          >
            <button
              type="button"
              className="community-dropdown-trigger"
              aria-haspopup="listbox"
              aria-expanded={communityOpen}
              onClick={() => setCommunityOpen((v) => !v)}
            >
              {activeCommunity.symbol && (
                <span className={`market-symbol ${activeCommunity.symbolClass}`}>{activeCommunity.symbol}</span>
              )}
              {activeCommunity.label}
              <span className="community-dropdown-caret" aria-hidden="true">▾</span>
            </button>
            {communityOpen && (
              <div className="community-dropdown-menu" role="listbox">
                {COMMUNITIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={community === c.id}
                    className={community === c.id ? "active" : ""}
                    onClick={() => {
                      setCommunity(c.id);
                      setCommunityOpen(false);
                    }}
                  >
                    {c.symbol && <span className={`market-symbol ${c.symbolClass}`}>{c.symbol}</span>}
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
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
