"use client";

import { useState } from "react";
import { POST_REPLIES, type Market, type MarketCall, type Outcome, type Post, type PostFlair, type PostImage as PostImageData, type Reply } from "@/app/lib/mockPosts";
import { RANK_TIERS, type RoomId } from "@/app/lib/roomsMocks";
import { FlameIcon, FollowingIcon, ForYouIcon, LiveCallsIcon } from "@/app/icons";
import { PostMenu } from "@/app/PostMenu";

// Deterministic hash so the same handle always gets the same gradient —
// stands in for a real avatar image without needing asset uploads.
function hueFromHandle(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash << 5) - hash + handle.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function avatarGradient(handle: string): string {
  const hue = hueFromHandle(handle);
  return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 45) % 360} 70% 32%))`;
}

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

// "Gold II" -> "gold". Drives the post's data-rank outline, which reuses the
// Rooms tier color tokens in app/globals.css.
function rankTier(rank?: string): RoomId | undefined {
  const tier = rank?.split(" ")[0].toLowerCase();
  return RANK_TIERS.find((t) => t === tier);
}

const FLAIRS: Record<PostFlair, { label: string; Icon: typeof FlameIcon }> = {
  forYou: { label: "You might like this post", Icon: ForYouIcon },
  engaging: { label: "People are engaging with this post", Icon: FlameIcon },
  copying: { label: "Traders are piling into this call", Icon: LiveCallsIcon },
  followed: { label: "Popular with people you follow", Icon: FollowingIcon },
};

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const MARKET_META: Record<Market, { label: string; symbol: string; symbolClass: string }> = {
  btc: { label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  eth: { label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
};

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  if (outcome.status === "won") {
    return <div className="call-outcome call-outcome--won">✓ WON +{outcome.amount?.toLocaleString()}</div>;
  }
  if (outcome.status === "lost") {
    return <div className="call-outcome call-outcome--lost">✕ LOST −{outcome.amount?.toLocaleString()}</div>;
  }
  return <div className="call-outcome call-outcome--close">◐ {outcome.diff}</div>;
}

function CopierCount({ count, seed }: { count: number; seed: string }) {
  return (
    <span className="market-call-copiers">
      <span className="copier-stack" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ background: avatarGradient(`copier${i}:${seed}`) }} />
        ))}
      </span>
      <span className="copiers-text">
        <strong>{compactCount.format(count).toLowerCase()}</strong> people copied this trade
      </span>
    </span>
  );
}

function MarketCallCard({ call }: { call: MarketCall }) {
  const meta = MARKET_META[call.market];
  const isLong = call.side === "LONG";
  const isChangeUp = call.changePct >= 0;
  return (
    <div className={`market-call${call.outcome ? "" : " market-call--open"}`}>
      <div className="market-call-head">
        <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
        <strong>
          {meta.label} {isLong ? "↑" : "↓"} {call.side}
          {call.leverage ? ` · ${call.leverage}x` : ""}
        </strong>
        {call.outcome && (
          <svg className={`call-spark ${isChangeUp ? "is-up" : "is-down"}`} viewBox="0 0 56 18" preserveAspectRatio="none" aria-hidden="true">
            <path d={sparkPath(call.spark)} />
          </svg>
        )}
      </div>
      {!call.outcome && (
        <div className="market-call-copy-wrap">
          <button type="button" className="market-call-copy" aria-label={`Copy ${meta.label} trade`}>
            ↗ Copy trade
          </button>
          {call.copiedBy !== undefined && <CopierCount count={call.copiedBy} seed={`${call.market}-${call.entryPrice}`} />}
        </div>
      )}
      <div className="market-call-prices">
        <span>${call.entryPrice}</span>
        <span className="call-arrow" aria-hidden="true">→</span>
        <span>${call.currentPrice}</span>
        <span className={`call-change ${isChangeUp ? "is-up" : "is-down"}`}>
          {isChangeUp ? "+" : ""}
          {call.changePct}%
        </span>
      </div>
      {call.outcome && <OutcomeBadge outcome={call.outcome} />}
      {!call.outcome && call.expiresIn && <div className="call-expiry">resolves in {call.expiresIn}</div>}
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
          <strong>{reply.author}</strong>
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
    <article className="post-card post-card--streak">
      <div className="streak-banner">
        <FlameIcon className="streak-icon" />
        <div className="streak-copy">
          <strong>{post.author}</strong> <span className="muted">{post.handle} · {post.timestamp}</span>
          <p>{post.content}</p>
        </div>
        {post.streakStat && <span className="streak-stat">{post.streakStat}</span>}
      </div>
    </article>
  );
}

function PromoCard({ post }: { post: Post }) {
  return (
    <article className="post-card post-card--promo">
      <span className="promo-dot" aria-hidden="true" />
      <p className="promo-text">{post.content}</p>
      <span className="muted promo-time">{post.timestamp}</span>
    </article>
  );
}

export function PostCard({ post }: { post: Post }) {
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (post.kind === "streak") return <StreakCard post={post} />;
  if (post.kind === "promo") return <PromoCard post={post} />;

  const firstName = post.author.split(" ")[0];
  const isLongPost = post.content.length > 220;
  const flair = post.flair && FLAIRS[post.flair];

  return (
    <article className="post-card" data-rank={rankTier(post.rank)}>
      <div className="post-avatar" aria-hidden="true" style={{ background: avatarGradient(post.handle) }}>
        {post.avatarInitial}
      </div>
      <div className="post-body">
        {flair && (
          <p className={`post-flair post-flair--${post.flair}`}>
            <flair.Icon className="post-flair-icon" />
            {flair.label}
          </p>
        )}
        <div className="post-meta">
          <strong>{post.author}</strong>
          <span className="muted">{post.handle}</span>
          <span className="muted">· {post.timestamp}</span>
          <span className="post-meta-trail">
            {post.rank && (
              <span
                className="rank-badge"
                style={{ "--shine-delay": `-${(hueFromHandle(post.handle) % 24) / 10}s` } as React.CSSProperties}
              >
                {post.rank}
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
            className={`action-like${liked ? " is-active" : ""}`}
            aria-pressed={liked}
            onClick={() => setLiked((v) => !v)}
          >
            <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {post.likes + (liked ? 1 : 0)}
          </button>
          <button
            type="button"
            className="action-reply"
            aria-expanded={repliesOpen}
            onClick={() => setRepliesOpen((v) => !v)}
          >
            💬 Reply {post.replies}
            <span className="action-reply-caret" aria-hidden="true">{repliesOpen ? "▴" : "▾"}</span>
          </button>
        </div>
        {repliesOpen && <ReplyThread postId={post.id} />}
      </div>
    </article>
  );
}
