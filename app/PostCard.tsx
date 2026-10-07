"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { avatarGradient } from "@/app/lib/avatar";
import { callRoi, callTrack, formatCallPrice, signedPct, type CallTrack } from "@/app/lib/calls";
import { profileHref } from "@/app/lib/mockProfiles";
import { useBookmarks } from "@/app/lib/postLists";
import { rankTier } from "@/app/lib/rank";
import { RankBadge } from "@/app/RankBadge";
import { POST_REPLIES, type Clash, type Market, type MarketCall, type Post, type PostFlair, type Reply, type Share } from "@/app/lib/mockPosts";
import { TopicIcon } from "@/app/FeedTopics";
import { BookmarkIcon, ClashIcon, CommentIcon, DefyIcon, FlameIcon, HeartIcon, TrendIcon, VouchIcon } from "@/app/icons";
import { postTopics, topicById, type TopicId } from "@/app/lib/topics";
import { PostMedia } from "@/app/PostMedia";
import { PostMenu } from "@/app/PostMenu";
import { ReshareHead, type ReshareKind } from "@/app/PostShare";

// Short tag at the right of the meta row; the full sentence is its tooltip.
const FLAIRS: Record<PostFlair, { tag: string; title: string }> = {
  forYou: { tag: "For you", title: "You might like this post" },
  engaging: { tag: "Hot", title: "People are engaging with this post" },
  copying: { tag: "Rising", title: "Traders are piling into this call" },
  followed: { tag: "Followed", title: "Popular with people you follow" },
};

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (n: number) => compactCount.format(n).toLowerCase();

const MARKET_META: Record<Market, { label: string; symbol: string; symbolClass: string }> = {
  btc: { label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  eth: { label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  sol: { label: "SOL", symbol: "◎", symbolClass: "sol-symbol" },
  doge: { label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
};

// Overlapping avatar circles + "18.4k tailing" under the Copy button. The
// circles are gradient placeholders seeded per call, not real copiers.
function TailingCount({ count, seed }: { count: number; seed: string }) {
  return (
    <span className="market-call-tailing">
      <span className="copier-stack" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ background: avatarGradient(`copier${i}:${seed}`) }} />
        ))}
      </span>
      <span>
        <strong>{compact(count)}</strong> tailing
      </span>
    </span>
  );
}

// Coin inside a ring that drains as the call's window runs out (full once
// resolved; its color follows the call state).
function TimeRing({ call, timeLeft }: { call: MarketCall; timeLeft: number }) {
  const meta = MARKET_META[call.market];
  const r = 19;
  const circumference = 2 * Math.PI * r;
  return (
    <span className="call-ring" title={call.outcome ? undefined : `${Math.round(timeLeft * 100)}% of the window left`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="call-ring-track" cx="22" cy="22" r={r} />
        <circle
          className="call-ring-fill"
          cx="22"
          cy="22"
          r={r}
          strokeDasharray={`${circumference * timeLeft} ${circumference}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
    </span>
  );
}

// Doom (stop/liq) on the left, destiny ✦ on the right; the orb is the price
// now, the tick is where the call was cast. The segment between them is the
// move so far.
function CallTrackBar({ call, track }: { call: MarketCall; track: CallTrack }) {
  const price = (n: number) => formatCallPrice(call, n);
  const lo = Math.min(track.castAt, track.nowAt);
  const hi = Math.max(track.castAt, track.nowAt);
  const doomLabel = `${track.state === "liquidated" ? "× " : ""}${track.doomKind === "liq" ? "Liq" : "Stop"} ${price(track.doom)}`;
  return (
    <div className="call-track">
      <div
        className="call-track-rail"
        role="img"
        aria-label={`${doomLabel}, cast ${price(track.cast)}, now ${price(track.now)}, target ${price(track.destiny)}`}
      >
        <span className="call-track-fill" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
        <span className="call-track-cast" style={{ left: `${track.castAt * 100}%` }} />
        <span className="call-track-destiny" aria-hidden="true">✦</span>
        <span className="call-track-orb" style={{ left: `${track.nowAt * 100}%` }} />
      </div>
      <div className="call-track-labels" aria-hidden="true">
        <span className="call-track-doom-label">{doomLabel}</span>
        <span className="call-track-cast-label" style={{ left: `${Math.min(68, Math.max(32, track.castAt * 100))}%` }}>
          Cast {price(track.cast)}
        </span>
        <span className="call-track-destiny-label">
          {track.state === "fulfilled" ? "✦ " : ""}
          {price(track.destiny)}
        </span>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<CallTrack["state"], (track: CallTrack) => string> = {
  live: () => "Live",
  doom: (t) => `⚠ ${t.doomDistancePct.toFixed(1)}% to ${t.doomKind}`,
  fulfilled: () => "✦ Fulfilled",
  broken: () => "Broken",
  liquidated: () => "× Liquidated",
};

// Five states (data-state): live (violet ring, pulsing orb), doom = near
// stop/liq (orb hugging the left, red pulse), fulfilled (orb on ✦, all gold),
// broken (grayed out), liquidated (red, hazard stripes). Outside those state
// moments only the coin, the side (LONG green / SHORT red), P&L (ROI, fill,
// orb) and Copy carry color. Open calls end in Copy with the tailing count
// under it.
export function MarketCallCard({ call }: { call: MarketCall }) {
  const meta = MARKET_META[call.market];
  const isLong = call.side === "LONG";
  const track = callTrack(call);
  const open = track.state === "live" || track.state === "doom";
  const terms = [
    call.leverage && `${call.leverage}x`,
    track.state === "liquidated" ? "wiped" : open ? call.expiresIn && `${call.expiresIn} left` : "closed",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="market-call-frame">
      <div
        className={`market-call${open ? "" : " market-call--closed"}`}
        data-state={track.state}
        data-dir={track.nowAt >= track.castAt ? "up" : "down"}
      >
        <TimeRing call={call} timeLeft={track.timeLeft} />
        <div className="market-call-name">
          <span className="market-call-asset">
            <strong>{meta.label}</strong>
            <span className={`call-side ${isLong ? "is-up" : "is-down"}`}>
              {isLong ? "↑" : "↓"}
              {call.side}
            </span>
          </span>
          {terms && <span className="market-call-terms">{terms}</span>}
        </div>
        <CallTrackBar call={call} track={track} />
        <div className="market-call-roi">
          <strong>{signedPct(callRoi(call))}</strong>
          <span className="market-call-status">{STATUS_LABEL[track.state](track)}</span>
        </div>
        {open && (
          <div className="market-call-action">
            <button type="button" className="market-call-copy" aria-label={`Copy ${meta.label} trade`}>
              <TrendIcon className="market-call-copy-icon" />
              Copy
            </button>
            {call.copiedBy !== undefined && <TailingCount count={call.copiedBy} seed={`${call.market}-${call.entryPrice}`} />}
          </div>
        )}
      </div>
    </div>
  );
}

const REPLIES_SHOWN_INITIALLY = 2;

export function ReplyItem({ reply }: { reply: Reply }) {
  const [liked, setLiked] = useState(false);
  return (
    <div className="reply-item">
      <div className="reply-avatar" aria-hidden="true" style={{ background: avatarGradient(reply.handle) }}>
        {reply.avatarInitial}
      </div>
      <div className="reply-body">
        <div className="reply-meta">
          <AuthorLink handle={reply.handle} name={reply.author} />
          <span className="muted">{reply.handle}</span>
          <span className="muted">· {reply.timestamp}</span>
        </div>
        <p className="reply-content">{reply.content}</p>
        <div className="reply-actions">
          <button
            type="button"
            className={`action-like${liked ? " is-active" : ""}`}
            aria-pressed={liked}
            aria-label={`Like (${reply.likes + (liked ? 1 : 0)})`}
            onClick={() => setLiked((v) => !v)}
          >
            <HeartIcon filled={liked} /> {compact(reply.likes + (liked ? 1 : 0))}
          </button>
          <button type="button" className="action-reply">Reply</button>
        </div>
      </div>
    </div>
  );
}

// Inline expand-in-place thread (Reddit-style, not a TikTok overlay): shows
// the first couple of already-loaded POST_REPLIES, "view N more" just
// reveals the rest of that same local array — there's no backend to fetch
// against.
function ReplyThread({ postId }: { postId: string }) {
  const [shown, setShown] = useState(REPLIES_SHOWN_INITIALLY);
  const replies = POST_REPLIES[postId] ?? [];

  if (replies.length === 0) {
    return <p className="muted reply-thread-empty">No replies yet — be the first.</p>;
  }

  const visible = replies.slice(0, shown);
  const remaining = replies.length - visible.length;

  return (
    <div className="reply-thread">
      {visible.map((reply) => (
        <ReplyItem key={reply.id} reply={reply} />
      ))}
      {remaining > 0 && (
        <button type="button" className="reply-thread-more" onClick={() => setShown((n) => n + remaining)}>
          View {remaining} more {remaining === 1 ? "reply" : "replies"}
        </button>
      )}
    </div>
  );
}

function StreakCard({ post }: { post: Post }) {
  return (
    <article className="post-card post-card--streak" id={`post-${post.id}`}>
      <div className="streak-banner">
        <FlameIcon className="streak-icon" />
        <div className="streak-copy">
          <AuthorLink handle={post.handle} name={post.author} /> <span className="muted">{post.handle} · {post.timestamp}</span>
          <p>{post.content}</p>
        </div>
        {post.streakStat && <span className="streak-stat">{post.streakStat}</span>}
      </div>
    </article>
  );
}

function PromoCard({ post }: { post: Post }) {
  return (
    <article className="post-card post-card--promo" id={`post-${post.id}`}>
      <span className="promo-dot" aria-hidden="true" />
      <p className="promo-text">{post.content}</p>
      <span className="muted promo-time">{post.timestamp}</span>
    </article>
  );
}

// Two opposing calls; the crowd votes for a side. Your vote is local-only:
// it adds one to that side, recomputes the split, and can be switched or
// taken back. Sides stay neutral (the arrows say which way each calls it);
// your side of the bar turns violet once you vote (data-vote).
function ClashCard({ post, clash }: { post: Post; clash: Clash }) {
  const [vote, setVote] = useState<0 | 1 | null>(null);
  const [a, b] = clash.sides;
  const counts = clash.sides.map((side, i) => side.votes + (vote === i ? 1 : 0));
  const total = counts[0] + counts[1];
  const firstPct = Math.round((counts[0] / total) * 100);
  const pcts = [firstPct, 100 - firstPct];
  const arrow = (direction: "up" | "down") => (direction === "up" ? "↑" : "↓");
  return (
    <article className="post-card post-card--clash" id={`post-${post.id}`}>
      <p className="clash-eyebrow">
        <ClashIcon className="clash-icon" />
        Omen clash · {MARKET_META[clash.market].label} by {clash.deadline}
        <span className="clash-votes">{total.toLocaleString()} votes</span>
      </p>
      <div className="clash-sides">
        <span className="clash-side">
          <AuthorLink handle={a.handle} name={a.name} />
          <span>
            {arrow(a.direction)} {a.target}
          </span>
        </span>
        <span className="clash-vs">vs</span>
        <span className="clash-side clash-side--right">
          <span>
            {arrow(b.direction)} {b.target}
          </span>
          <AuthorLink handle={b.handle} name={b.name} />
        </span>
      </div>
      <div className="clash-bar" data-vote={vote ?? undefined} aria-hidden="true">
        <span style={{ width: `${pcts[0]}%` }} />
      </div>
      <div className="clash-picks">
        {clash.sides.map((side, i) => (
          <button
            key={side.handle}
            type="button"
            className="clash-pick"
            aria-pressed={vote === i}
            onClick={() => setVote((current) => (current === i ? null : (i as 0 | 1)))}
          >
            {vote === i ? `✓ Sided with ${side.name}` : `Side with ${side.name}`} · {pcts[i]}%
          </button>
        ))}
      </div>
    </article>
  );
}

// Composer posts (`local-…`) only exist in the feed's state, so they have no
// page to open.
export const postHref = (post: Post) => (post.id.startsWith("local-") ? undefined : `/post/${encodeURIComponent(post.id)}`);

// Clicks on the row's background open the post page, like X/Reddit. Anything
// interactive inside keeps its own click, and selecting text doesn't navigate.
const INTERACTIVE = "a, button, input, textarea, label, form, [role='button'], [role='menu']";

// `context` is a line above the row (the For You cover's "Because you're
// interested in …"); `footer` sits under the actions. `detail` is the post
// page layout (app/post/[id]/PostThread.tsx): full text, topic pills, no
// inline thread — `onReply` then focuses that page's reply box instead.
// `onNotInterested` adds "Not interested in <topic>" to the ⋯ menu. `share`
// is a followed account's vouch/defy: like an X quote post, the sharer gets
// their own header row and the original post drops into a bordered card
// under it (your own vouch/defy does the same, replacing theirs). None of it
// applies to streak/promo/clash cards.
export function PostCard({
  post,
  context,
  footer,
  detail = false,
  onReply,
  onNotInterested,
  share,
}: {
  post: Post;
  context?: ReactNode;
  footer?: ReactNode;
  detail?: boolean;
  onReply?: () => void;
  onNotInterested?: (id: TopicId) => void;
  share?: Share;
}) {
  const router = useRouter();
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  // Your own repost of this post — a vouch or a defy, not both. Local only,
  // like likes.
  const [reshared, setReshared] = useState<ReshareKind | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bookmarks = useBookmarks();

  if (post.kind === "streak") return <StreakCard post={post} />;
  if (post.kind === "promo") return <PromoCard post={post} />;
  if (post.kind === "clash" && post.clash) return <ClashCard post={post} clash={post.clash} />;

  const firstName = post.author.split(" ")[0];
  const isLongPost = !detail && post.content.length > 220;
  const flair = post.flair && FLAIRS[post.flair];
  const bookmarked = bookmarks.has(post.id);
  const href = profileHref(post.handle);
  const url = detail ? undefined : postHref(post);
  const topics = postTopics(post).map(topicById);
  // The name link is the accessible one; the avatar link is a mouse-only
  // duplicate, so it stays out of the tab order and the a11y tree.
  const avatarProps = { className: "post-avatar", "aria-hidden": true, style: { background: avatarGradient(post.handle) } };
  const likes = post.likes + (liked ? 1 : 0);
  const vouches = (post.vouches ?? 0) + (reshared === "vouch" ? 1 : 0);
  const defies = (post.defies ?? 0) + (reshared === "defy" ? 1 : 0);
  const toggleReshare = (kind: ReshareKind) => setReshared((current) => (current === kind ? null : kind));
  const reshare = reshared ? (
    <ReshareHead kind={reshared} name="You" timestamp="now" />
  ) : share ? (
    <ReshareHead kind={share.kind} name={share.name} handle={share.handle} timestamp={share.timestamp} />
  ) : null;
  // The post page keeps its own layout; it just gets the header on top.
  const embedded = reshare !== null && !detail;

  function openPost(event: MouseEvent<HTMLElement>) {
    if (!url || (event.target as HTMLElement).closest(INTERACTIVE) || window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(url, "_blank");
    else router.push(url);
  }

  const row = (
    <>
    {href ? (
      <Link href={href} tabIndex={-1} {...avatarProps}>
        {post.avatarInitial}
      </Link>
    ) : (
      <div {...avatarProps}>{post.avatarInitial}</div>
    )}
    <div className="post-body">
      <div className="post-meta">
        <AuthorLink handle={post.handle} name={post.author} />
        {post.rank && <RankBadge rank={post.rank} seed={post.handle} />}
        <span className="muted">
          {post.handle}
          {!detail && (
            <>
              {" · "}
              {url ? (
                <Link href={url} className="post-time">
                  {post.timestamp}
                </Link>
              ) : (
                post.timestamp
              )}
            </>
          )}
        </span>
        <span className="post-meta-trail">
          {flair && (
            <span className="post-tag" title={flair.title}>
              {flair.tag}
            </span>
          )}
          <PostMenu firstName={firstName} topics={topics} onNotInterested={onNotInterested} />
        </span>
      </div>
      <div className={`post-content${isLongPost && !expanded ? " is-collapsed" : ""}`}>
        {post.content.split(/\n\n+/).map((paragraph, index) => (
          <p key={`${post.id}-paragraph-${index}`}>{paragraph}</p>
        ))}
      </div>
      {isLongPost && (
        <button type="button" className="post-read-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
      {post.media && <PostMedia media={post.media} />}
      {post.call && <MarketCallCard call={post.call} />}
      {detail && (
        <p className="post-detail-meta">
          <span>{post.timestamp}</span>
          {topics.map((topic) => (
            <span key={topic.id} className="post-detail-topic">
              <TopicIcon topic={topic} />
              {topic.label}
            </span>
          ))}
        </p>
      )}
      <div className="post-actions">
        <button
          type="button"
          className={`action-like${liked ? " is-active" : ""}`}
          aria-pressed={liked}
          aria-label={`Like (${likes})`}
          onClick={() => setLiked((v) => !v)}
        >
          <HeartIcon filled={liked} />
          {compact(likes)}
        </button>
        <button
          type="button"
          className="action-reply"
          aria-expanded={onReply ? undefined : repliesOpen}
          aria-label={`Comment (${post.replies})`}
          onClick={() => (onReply ? onReply() : setRepliesOpen((v) => !v))}
        >
          <CommentIcon />
          {compact(post.replies)}
        </button>
        <button
          type="button"
          className={`action-vouch${reshared === "vouch" ? " is-active" : ""}`}
          aria-pressed={reshared === "vouch"}
          aria-label={`Vouch (${vouches}): repost to your followers as one you back`}
          title="Vouch: repost to your followers as one you back"
          onClick={() => toggleReshare("vouch")}
        >
          <VouchIcon />
          <span className="action-label">Vouch</span>
          {compact(vouches)}
        </button>
        <button
          type="button"
          className={`action-defy${reshared === "defy" ? " is-active" : ""}`}
          aria-pressed={reshared === "defy"}
          aria-label={`Defy (${defies}): repost to your followers as one you're against`}
          title="Defy: repost to your followers as one you're against"
          onClick={() => toggleReshare("defy")}
        >
          <DefyIcon />
          <span className="action-label">Defy</span>
          {compact(defies)}
        </button>
        <button
          type="button"
          className={`action-bookmark${bookmarked ? " is-active" : ""}`}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? "Remove bookmark" : "Bookmark post"}
          onClick={() => bookmarks.toggle(post.id)}
        >
          <BookmarkIcon filled={bookmarked} />
        </button>
      </div>
      {repliesOpen && <ReplyThread postId={post.id} />}
      {!embedded && footer}
    </div>
    </>
  );

  return (
    <article
      className={`post-card${context || reshare ? " post-card--context" : ""}${embedded ? " post-card--reshared" : ""}${detail ? " post-card--detail" : ""}${url ? " is-linkable" : ""}`}
      id={`post-${post.id}`}
      data-rank={rankTier(post.rank)}
      onClick={openPost}
    >
      {context && <div className="post-context">{context}</div>}
      {reshare}
      {embedded ? (
        <>
          <div className="post-reshare-embed">{row}</div>
          {footer && <div className="post-reshare-footer">{footer}</div>}
        </>
      ) : (
        row
      )}
    </article>
  );
}
