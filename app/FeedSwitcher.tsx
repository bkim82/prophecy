"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { avatarGradient, PostCard } from "@/app/PostCard";
import { FOLLOWED_HANDLES, LIVE_CALL_COUNT, type Market, type Post } from "@/app/lib/mockPosts";
import { markViewed, useBookmarks, useRecentlyViewed } from "@/app/lib/postLists";
import { BookmarkIcon, FollowingIcon, ForYouIcon, LiveCallsIcon } from "@/app/icons";

type FilterId = "forYou" | "following" | "live" | "bookmarked";

const FILTERS: { id: FilterId; label: string; Icon: typeof ForYouIcon }[] = [
  { id: "forYou", label: "For You", Icon: ForYouIcon },
  { id: "following", label: "Following", Icon: FollowingIcon },
  { id: "live", label: "Live Calls", Icon: LiveCallsIcon },
  { id: "bookmarked", label: "Bookmarked", Icon: BookmarkIcon },
];

// A post counts as viewed once it has sat at least half on screen (or filled
// half the viewport, for cards taller than that) for this long.
const VIEW_DWELL_MS = 1000;

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
  const { ids: bookmarkIds } = useBookmarks();
  const recent = useRecentlyViewed();
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    let result = posts;
    if (filter === "following") result = result.filter((post) => FOLLOWED_HANDLES.includes(post.handle));
    if (filter === "live") result = result.filter((post) => post.kind === "call");
    if (filter === "bookmarked") result = result.filter((post) => bookmarkIds.includes(post.id));
    if (community !== "all") {
      result = result.filter((post) => (post.market ?? post.call?.market) === community);
    }
    return result;
  }, [filter, community, posts, bookmarkIds]);

  const recentPosts = recent.ids.flatMap((id) => posts.find((post) => post.id === id) ?? []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const seen =
            entry.isIntersecting &&
            (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= window.innerHeight / 2);
          const pending = timers.get(entry.target);
          if (seen && pending === undefined) {
            const id = (entry.target as HTMLElement).dataset.postId!;
            timers.set(entry.target, window.setTimeout(() => markViewed(id), VIEW_DWELL_MS));
          } else if (!seen && pending !== undefined) {
            window.clearTimeout(pending);
            timers.delete(entry.target);
          }
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    list.querySelectorAll("[data-post-id]").forEach((card) => observer.observe(card));
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [visible]);

  // Recently viewed rows jump back to the post in the feed, widening the
  // filters first if the current view hides it.
  function jumpToPost(id: string) {
    if (!visible.some((post) => post.id === id)) {
      flushSync(() => {
        setFilter("forYou");
        setCommunity("all");
      });
    }
    const card = listRef.current?.querySelector<HTMLElement>(`[data-post-id="${id}"]`);
    if (!card) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    card.classList.remove("is-flash");
    void card.offsetWidth; // restart the flash on a repeat click
    card.classList.add("is-flash");
  }

  const activeCommunity = COMMUNITIES.find((c) => c.id === community)!;

  return (
    <>
      <nav className="feed-nav" aria-label="Feeds">
        <p className="feed-nav-label">Feeds</p>
        <div className="feed-tabs" role="tablist" aria-label="Feed filter">
          {FILTERS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              <Icon className="feed-nav-icon" />
              {label}
              {id === "live" && (
                <span className="feed-nav-live" title={`${LIVE_CALL_COUNT.toLocaleString()} live calls`}>
                  <span className="feed-nav-live-dot" aria-hidden="true" />
                  {LIVE_CALL_COUNT.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
        <section className="feed-recent" aria-labelledby="feed-recent-label">
          <p className="feed-nav-label" id="feed-recent-label">Recently viewed</p>
          {recentPosts.length === 0 ? (
            <p className="feed-recent-empty">Posts you read will show up here.</p>
          ) : (
            <ul className="feed-recent-list">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <button type="button" onClick={() => jumpToPost(post.id)}>
                    <span className="feed-recent-avatar" aria-hidden="true" style={{ background: avatarGradient(post.handle) }}>
                      {post.avatarInitial}
                    </span>
                    <span className="feed-recent-text">
                      <strong>{post.author}</strong>
                      <span>{post.content}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recentPosts.length > 0 && (
            <button type="button" className="feed-recent-clear" onClick={recent.clear}>
              Clear
            </button>
          )}
        </section>
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
        <div className="feed-list" ref={listRef}>
          {visible.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          {visible.length === 0 && (
            <p className="muted feed-empty">
              {filter === "bookmarked" ? "No bookmarks yet — tap the bookmark on any post to save it here." : "Nothing here yet."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
