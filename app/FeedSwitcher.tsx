"use client";

import { useMemo, useState } from "react";
import { CallStrip } from "@/app/CallStrip";
import { FeedComposer } from "@/app/FeedComposer";
import { PostCard } from "@/app/PostCard";
import { FOLLOWED_HANDLES, LIVE_CALL_COUNT, type Market, type Post } from "@/app/lib/mockPosts";

type FilterId = "forYou" | "following" | "live" | "clashes";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "forYou", label: "For You" },
  { id: "following", label: "Following" },
  { id: "live", label: "Live Calls" },
  { id: "clashes", label: "Clashes" },
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
  // Posts written in the composer this session, newest first. Never persisted.
  const [localPosts, setLocalPosts] = useState<Post[]>([]);

  const visible = useMemo(() => {
    let result = [...localPosts, ...posts];
    if (filter === "following") result = result.filter((post) => FOLLOWED_HANDLES.includes(post.handle));
    if (filter === "live") result = result.filter((post) => post.kind === "call");
    if (filter === "clashes") result = result.filter((post) => post.kind === "clash");
    if (community !== "all") {
      result = result.filter((post) => (post.market ?? post.call?.market) === community);
    }
    return result;
  }, [filter, community, posts, localPosts]);

  const activeCommunity = COMMUNITIES.find((c) => c.id === community)!;

  return (
    <>
      <nav className="feed-nav" aria-label="Feeds">
        <p className="feed-nav-label">Feeds</p>
        <div className="feed-tabs" role="tablist" aria-label="Feed filter">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === "live" && (
                <span className="feed-nav-live" aria-label={`${LIVE_CALL_COUNT} live`}>
                  {LIVE_CALL_COUNT}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
      <div className="feed-main">
        <section className="feed-heading">
          <div className="feed-heading-row">
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
                {community === "all" ? "Topics" : activeCommunity.label}
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
        <div className="feed-panel">
          <FeedComposer onPost={(post) => setLocalPosts((current) => [post, ...current])} />
          <CallStrip posts={visible} />
          <div className="feed-list">
            {visible.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
            {visible.length === 0 && <p className="muted feed-empty">Nothing here yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
