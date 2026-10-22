"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FeedComposer } from "@/app/FeedComposer";
import { CoverEyebrow, InterestPicker, MixBanner, MutedNotice, SeeMore, TopicChips, TopicHeader, type TopicView } from "@/app/FeedTopics";
import { ComposeIcon } from "@/app/icons";
import { PostCard } from "@/app/PostCard";
import { clearFreshPost, useFreshPostId } from "@/app/lib/freshPost";
import { LIVE_CALL_COUNT, SHARES, type Post, type Share } from "@/app/lib/mockPosts";
import { useBookmarks, useInterests, useMutedTopics } from "@/app/lib/postLists";
import { ageMinutes, blendTopics, personalize, pickCovers, postTopics, topicById, type Cover, type Topic, type TopicId } from "@/app/lib/topics";

type FilterId = "forYou" | "following" | "live" | "clashes" | "bookmarked";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "forYou", label: "For You" },
  { id: "following", label: "Following" },
  { id: "live", label: "Live Calls" },
  { id: "clashes", label: "Clashes" },
  { id: "bookmarked", label: "Bookmarked" },
];

// The latest repost per post by someone you follow: real accounts' saved
// ones (`saved`, already limited to who you follow) and the mock `SHARES`.
// It's the line shown above that post wherever it appears, and it pulls the
// post into Following.
function followedShares(followed: string[], saved: Share[]): Map<string, Share> {
  const shares = new Map<string, Share>();
  for (const share of [...saved, ...SHARES.filter((mock) => followed.includes(mock.handle))]) {
    const current = shares.get(share.postId);
    if (!current || ageMinutes(share.timestamp) < ageMinutes(current.timestamp)) shares.set(share.postId, share);
  }
  return shares;
}

// When a post reached your Following feed: posted, or later reshared.
function followingAge(post: Post, shares: Map<string, Share>): number {
  const share = shares.get(post.id);
  return Math.min(ageMinutes(post.timestamp), share ? ageMinutes(share.timestamp) : Infinity);
}

// "Not interested" leaves a notice where the post was (`index` into the rows
// at click time), only in the view (`scope`) it was clicked in. `followAt` is
// where Undo puts the topic back in your interests.
type Notice = { topic: TopicId; index: number; followAt: number; scope: string };

type Row =
  | { kind: "post"; key: string; post: Post; cover?: Topic }
  | { kind: "label"; key: string }
  | { kind: "notice"; key: string; notice: Notice };

// `savedPosts` = omens from the `posts` table (lib/posts.ts feedPosts,
// rendered by app/page.tsx), newest first, pinned above everything else.
// `followed`: everyone you follow as "@handle"s (lib/follows.ts
// followedHandles); `shares`: what the real accounts among them reposted
// (lib/engagement.ts followedReshares).
export function FeedSwitcher({
  posts,
  savedPosts,
  followed,
  shares: savedShares,
}: {
  posts: Post[];
  savedPosts: Post[];
  followed: string[];
  shares: Share[];
}) {
  const shares = useMemo(() => followedShares(followed, savedShares), [followed, savedShares]);
  const [filter, setFilter] = useState<FilterId>("forYou");
  // Topic chip: "forYou" = every topic, else one followed (or opened) topic.
  const [view, setView] = useState<TopicView>("forYou");
  // "Mix it up": the For You home as a round-robin blend instead of covers.
  const [mixed, setMixed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Deleting your own saved post hides it at once; it comes back if
  // DELETE /api/posts/[id] fails.
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const shownSaved = useMemo(() => savedPosts.filter((post) => !deletedIds.includes(post.id)), [savedPosts, deletedIds]);
  // Just published from a composer: flashed once on its way in.
  const freshId = useFreshPostId();
  const { ids: bookmarkIds } = useBookmarks();
  const interests = useInterests();
  const muted = useMutedTopics();
  const [notices, setNotices] = useState<Notice[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // The For You home (rail For You + chip For You) is the personalized one:
  // one cover per interest on top, then the rest weighted to your topics.
  const home = filter === "forYou" && view === "forYou";

  const { pinned, covers, rest } = useMemo(() => {
    const keep = (post: Post) => {
      if (filter === "following" && !followed.includes(post.handle) && !shares.has(post.id)) return false;
      if (filter === "live" && post.kind !== "call") return false;
      if (filter === "clashes" && post.kind !== "clash") return false;
      if (filter === "bookmarked" && !bookmarkIds.includes(post.id)) return false;
      return view === "forYou" || postTopics(post).includes(view);
    };
    // Saved omens stay on top, above the covers.
    const pinned = shownSaved.filter(keep);
    const feed = posts.filter(keep);
    // Following runs on when things hit it, so a fresh vouch/defy of an old
    // post lands near the top. (Stable sort keeps ties in feed order.)
    if (filter === "following") feed.sort((a, b) => followingAge(a, shares) - followingAge(b, shares));
    const none: Cover[] = [];
    if (!home) return { pinned, covers: none, rest: feed };
    // Suggestions skip anything tagged with a "Not interested" topic.
    const suggestions = feed.filter((post) => !postTopics(post).some((id) => muted.ids.includes(id)));
    if (mixed) return { pinned, covers: none, rest: blendTopics(suggestions, interests.ids) };
    const covers = pickCovers(suggestions, interests.ids);
    const coverIds = new Set(covers.map((cover) => cover.post.id));
    return { pinned, covers, rest: personalize(suggestions.filter((post) => !coverIds.has(post.id)), interests.ids) };
  }, [filter, view, home, mixed, posts, followed, shares, shownSaved, bookmarkIds, interests.ids, muted.ids]);

  const visible = useMemo(() => [...pinned, ...covers.map((cover) => cover.post), ...rest], [pinned, covers, rest]);

  const scope = `${filter}:${view}:${mixed}`;
  const rows = useMemo(() => {
    const rows: Row[] = [
      ...pinned.map((post) => ({ kind: "post" as const, key: post.id, post })),
      ...covers.map(({ post, topic }) => ({ kind: "post" as const, key: post.id, post, cover: topic })),
      ...(covers.length > 0 && rest.length > 0 ? [{ kind: "label" as const, key: "more-for-you" }] : []),
      ...rest.map((post) => ({ kind: "post" as const, key: post.id, post })),
    ];
    const shown = notices.filter((notice) => notice.scope === scope && muted.ids.includes(notice.topic)).sort((a, b) => a.index - b.index);
    for (const notice of shown) rows.splice(Math.min(notice.index, rows.length), 0, { kind: "notice", key: `muted-${notice.topic}`, notice });
    return rows;
  }, [pinned, covers, rest, notices, scope, muted.ids]);

  function notInterested(topic: TopicId, postId?: string) {
    const at = postId === undefined ? 0 : rows.findIndex((row) => row.kind === "post" && row.post.id === postId);
    const followAt = muted.mute(topic);
    // Muting the topic you're looking at sends you back to all topics.
    const nextView = view === topic ? "forYou" : view;
    setView(nextView);
    setNotices((current) => [
      ...current.filter((notice) => notice.topic !== topic),
      { topic, index: Math.max(0, at), followAt, scope: `${filter}:${nextView}:${mixed}` },
    ]);
  }

  function undoNotInterested({ topic, followAt }: Notice) {
    muted.unmute(topic, followAt);
    setNotices((current) => current.filter((notice) => notice.topic !== topic));
  }

  // "See more on …": open the topic and bring the top of the feed back into
  // view, since the cover that was clicked may be far down.
  function openTopic(next: TopicView) {
    setView(next);
    const panel = panelRef.current;
    if (panel && panel.getBoundingClientRect().top < 0) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  async function deleteSaved(id: string) {
    setDeletedIds((current) => [...current, id]);
    const response = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
    if (!response?.ok) setDeletedIds((current) => current.filter((other) => other !== id));
  }

  useEffect(() => {
    if (!freshId) return;
    const timer = window.setTimeout(clearFreshPost, 2400);
    return () => window.clearTimeout(timer);
  }, [freshId]);

  const openTopicData = view === "forYou" ? null : topicById(view);

  return (
    <>
      <nav className="feed-nav" aria-label="Feeds">
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
        <Link href="/compose" className="feed-post-button">
          <ComposeIcon />
          Create Omen
        </Link>
      </nav>
      <Link href="/compose" className="compose-fab" aria-label="Create Omen" title="Create Omen">
        <ComposeIcon />
      </Link>
      <div className="feed-main">
        <div className="feed-panel" ref={panelRef}>
          <FeedComposer />
          {home && interests.ids.length > 1 && (
            <MixBanner mixed={mixed} topicCount={interests.ids.length} onToggle={() => setMixed((value) => !value)} />
          )}
          <TopicChips
            interests={interests.ids}
            view={view}
            homeLabel={filter === "forYou" ? "For You" : "All"}
            pickerOpen={pickerOpen}
            onSelect={setView}
            onTogglePicker={() => setPickerOpen((open) => !open)}
          />
          {pickerOpen && (
            <InterestPicker
              interests={interests.ids}
              muted={muted.ids}
              onToggle={interests.toggle}
              onUnmute={(id) => muted.unmute(id)}
              onClose={() => setPickerOpen(false)}
            />
          )}
          {openTopicData && (
            <TopicHeader
              topic={openTopicData}
              count={visible.length}
              following={interests.has(openTopicData.id)}
              onToggle={() => interests.toggle(openTopicData.id)}
              onNotInterested={() => notInterested(openTopicData.id)}
            />
          )}
          <div className="feed-list">
            {home && !mixed && interests.ids.length === 0 && (
              <p className="feed-covers-empty">
                Follow a few coins, companies or people and For You will open with a top post from each.
                <button type="button" onClick={() => setPickerOpen(true)}>
                  Pick interests
                </button>
              </p>
            )}
            {rows.map((row) => {
              if (row.kind === "label") return <p key={row.key} className="feed-section-label">More for you</p>;
              if (row.kind === "notice") {
                return <MutedNotice key={row.key} topic={topicById(row.notice.topic)} onUndo={() => undoNotInterested(row.notice)} />;
              }
              const { post, cover } = row;
              // "Not interested" only makes sense where suggestions are made.
              const onNotInterested = home ? (topic: TopicId) => notInterested(topic, post.id) : undefined;
              return (
                <PostCard
                  key={row.key}
                  post={post}
                  share={shares.get(post.id)}
                  onNotInterested={onNotInterested}
                  onDelete={post.mine && post.saved ? () => void deleteSaved(post.id) : undefined}
                  fresh={post.id === freshId}
                  onTopic={openTopic}
                  context={cover && <CoverEyebrow topic={cover} onNotInterested={() => notInterested(cover.id, post.id)} />}
                  footer={cover && <SeeMore topic={cover} onClick={() => openTopic(cover.id)} />}
                />
              );
            })}
            {visible.length === 0 && (
              <p className="muted feed-empty">
                {filter === "bookmarked" ? "No bookmarks yet — tap the bookmark on any post to save it here." : "Nothing here yet."}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
