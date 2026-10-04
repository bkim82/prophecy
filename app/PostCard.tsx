"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { avatarGradient } from "@/app/lib/avatar";
import { callRoi, callTrack, formatCallPrice, signedPct, type CallTrack } from "@/app/lib/calls";
import { profileHref } from "@/app/lib/mockProfiles";
import { rankTier } from "@/app/lib/rank";
import { RankBadge } from "@/app/RankBadge";
import { POST_REPLIES, type Clash, type Market, type MarketCall, type Post, type PostFlair, type PostImage as PostImageData, type Reply } from "@/app/lib/mockPosts";
import { ClashIcon, FlameIcon, TrendIcon } from "@/app/icons";
import { PostMenu } from "@/app/PostMenu";

function sparkPath(values: number[], width = 56, height = 18): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

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

// Five states (data-state): live (violet glow, pulsing orb), doom = near
// stop/liq (orb hugging the left, red pulse), fulfilled (orb on ✦, all gold),
// broken (grayed out), liquidated (red, hazard stripes). Open calls end in
// Copy with the tailing count under it.
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

function PostImage({ image }: { image: PostImageData }) {
  if (image.kind === "chart") {
    const isUp = image.spark[image.spark.length - 1] >= image.spark[0];
    return (
      <div className="post-image post-image--chart">
        <svg
          className={isUp ? "is-up" : "is-down"}
          viewBox="0 0 320 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={sparkPath(image.spark, 320, 120)} />
        </svg>
      </div>
    );
  }
  return (
    <div className="post-image post-image--meme" style={{ background: avatarGradient(image.seed) }}>
      <span aria-hidden="true">{image.emoji}</span>
    </div>
  );
}

const REPLIES_SHOWN_INITIALLY = 2;

function ReplyItem({ reply }: { reply: Reply }) {
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
            onClick={() => setLiked((v) => !v)}
          >
            <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {reply.likes + (liked ? 1 : 0)}
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
// taken back.
function ClashCard({ post, clash }: { post: Post; clash: Clash }) {
  const [vote, setVote] = useState<0 | 1 | null>(null);
  const [a, b] = clash.sides;
  const counts = clash.sides.map((side, i) => side.votes + (vote === i ? 1 : 0));
  const total = counts[0] + counts[1];
  const firstPct = Math.round((counts[0] / total) * 100);
  const pcts = [firstPct, 100 - firstPct];
  const tone = (direction: "up" | "down") => (direction === "up" ? "is-up" : "is-down");
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
          <span className={tone(a.direction)}>
            {arrow(a.direction)} {a.target}
          </span>
        </span>
        <span className="clash-vs">vs</span>
        <span className="clash-side clash-side--right">
          <span className={tone(b.direction)}>
            {arrow(b.direction)} {b.target}
          </span>
          <AuthorLink handle={b.handle} name={b.name} />
        </span>
      </div>
      <div className={`clash-bar ${tone(b.direction)}`} aria-hidden="true">
        <span className={tone(a.direction)} style={{ width: `${pcts[0]}%` }} />
      </div>
      <div className="clash-picks">
        {clash.sides.map((side, i) => (
          <button
            key={side.handle}
            type="button"
            className={`clash-pick ${tone(side.direction)}`}
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

export function PostCard({ post }: { post: Post }) {
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (post.kind === "streak") return <StreakCard post={post} />;
  if (post.kind === "promo") return <PromoCard post={post} />;
  if (post.kind === "clash" && post.clash) return <ClashCard post={post} clash={post.clash} />;

  const firstName = post.author.split(" ")[0];
  const isLongPost = post.content.length > 220;
  const flair = post.flair && FLAIRS[post.flair];
  const href = profileHref(post.handle);
  // The name link is the accessible one; the avatar link is a mouse-only
  // duplicate, so it stays out of the tab order and the a11y tree.
  const avatarProps = { className: "post-avatar", "aria-hidden": true, style: { background: avatarGradient(post.handle) } };
  const reposts = (post.reposts ?? 0) + (reposted ? 1 : 0);
  const likes = post.likes + (liked ? 1 : 0);

  return (
    <article className="post-card" id={`post-${post.id}`} data-rank={rankTier(post.rank)}>
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
            {post.handle} · {post.timestamp}
          </span>
          <span className="post-meta-trail">
            {flair && (
              <span className={`post-tag post-tag--${post.flair}`} title={flair.title}>
                {flair.tag}
              </span>
            )}
            <PostMenu firstName={firstName} />
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
        {post.image && <PostImage image={post.image} />}
        {post.call && <MarketCallCard call={post.call} />}
        <div className="post-actions">
          <button
            type="button"
            className="action-reply"
            aria-expanded={repliesOpen}
            aria-label={`Replies (${post.replies})`}
            onClick={() => setRepliesOpen((v) => !v)}
          >
            <span aria-hidden="true">↩</span> {compact(post.replies)}
          </button>
          <button
            type="button"
            className={`action-repost${reposted ? " is-active" : ""}`}
            aria-pressed={reposted}
            aria-label={`Repost (${reposts})`}
            onClick={() => setReposted((v) => !v)}
          >
            <span aria-hidden="true">⟲</span> {compact(reposts)}
          </button>
          <button
            type="button"
            className={`action-like${liked ? " is-active" : ""}`}
            aria-pressed={liked}
            aria-label={`Like (${likes})`}
            onClick={() => setLiked((v) => !v)}
          >
            <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {compact(likes)}
          </button>
        </div>
        {repliesOpen && <ReplyThread postId={post.id} />}
      </div>
    </article>
  );
}
