import type { Market, MarketCall, Outcome, Post, PostImage as PostImageData } from "@/app/lib/mockPosts";
import { FlameIcon } from "@/app/icons";
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

function MarketCallCard({ call }: { call: MarketCall }) {
  const meta = MARKET_META[call.market];
  const isLong = call.side === "LONG";
  const isChangeUp = call.changePct >= 0;
  return (
    <div className="market-call">
      <div className="market-call-head">
        <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
        <strong>
          {meta.label} {isLong ? "↑" : "↓"} {call.side}
          {call.leverage ? ` · ${call.leverage}x` : ""}
        </strong>
        <svg className={`call-spark ${isChangeUp ? "is-up" : "is-down"}`} viewBox="0 0 56 18" preserveAspectRatio="none" aria-hidden="true">
          <path d={sparkPath(call.spark)} />
        </svg>
      </div>
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
  if (post.kind === "streak") return <StreakCard post={post} />;
  if (post.kind === "promo") return <PromoCard post={post} />;

  const firstName = post.author.split(" ")[0];

  return (
    <article className="post-card">
      <div className="post-avatar" aria-hidden="true" style={{ background: avatarGradient(post.handle) }}>
        {post.avatarInitial}
      </div>
      <div className="post-body">
        <div className="post-meta">
          <strong>{post.author}</strong>
          <span className="muted">{post.handle}</span>
          <span className="muted">· {post.timestamp}</span>
          <span className="post-meta-trail">
            {post.rank && <span className="rank-badge">{post.rank}</span>}
            <PostMenu firstName={firstName} />
          </span>
        </div>
        <p className="post-content">{post.content}</p>
        {post.image && <PostImage image={post.image} />}
        {post.call && <MarketCallCard call={post.call} />}
        <div className="post-actions">
          <span className="action-like">♡ {post.likes}</span>
          <span className="action-reply">Reply {post.replies}</span>
        </div>
      </div>
    </article>
  );
}
