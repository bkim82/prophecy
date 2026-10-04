"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { LockIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { callTrack } from "@/app/lib/calls";
import type { ProfilePortfolio } from "@/app/lib/mockPortfolios";
import type { Profile, ProfileActivity, ProfileTrade } from "@/app/lib/mockProfiles";
import { rankTier } from "@/app/lib/rank";
import { MarketCallCard, PostCard } from "@/app/PostCard";
import { RankBadge } from "@/app/RankBadge";

type TabId = "omens" | "comments" | "trades" | "portfolio";

const TABS: { id: TabId; label: string }[] = [
  { id: "omens", label: "Omens" },
  { id: "comments", label: "Comments" },
  { id: "trades", label: "Trades" },
  { id: "portfolio", label: "Portfolio" },
];

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

type ProfileViewProps = {
  profile: Profile;
  activity: ProfileActivity;
  // null when locked (never sent) or when this user has no session.
  portfolio: ProfilePortfolio | null;
  portfolioLocked: boolean;
  viewerRank: string;
  initiallyFollowing: boolean;
};

export function ProfileView({ profile, activity, portfolio, portfolioLocked, viewerRank, initiallyFollowing }: ProfileViewProps) {
  const [tab, setTab] = useState<TabId>("omens");
  const [following, setFollowing] = useState(initiallyFollowing);
  // Local-only follow toggle, like the feed's like button — nothing persists.
  const followers = profile.followers + Number(following) - Number(initiallyFollowing);

  return (
    <div className="feed-main">
      <section className="profile-hero" data-rank={rankTier(profile.rank)}>
        <div className="profile-avatar" aria-hidden="true" style={{ background: avatarGradient(profile.handle) }}>
          {profile.avatarInitial}
        </div>
        {/* Opaque backing so the avatar doesn't show through the translucent badge it overlaps. */}
        <span className="profile-rank">
          <RankBadge rank={profile.rank} seed={profile.handle} size="lg" />
        </span>
        <div className="profile-identity">
          <h1>{profile.name}</h1>
          <span className="muted">{profile.handle}</span>
        </div>
        <p className="profile-bio">{profile.bio}</p>
        <p className="profile-stats">
          <span>Joined {profile.joined}</span>
          <span>
            <strong>{compactCount.format(followers).toLowerCase()}</strong> Followers
          </span>
          <span>
            <strong>{compactCount.format(profile.following).toLowerCase()}</strong> Following
          </span>
        </p>
        <button
          type="button"
          className={`profile-follow${following ? " is-following" : ""}`}
          aria-pressed={following}
          onClick={() => setFollowing((v) => !v)}
        >
          {following ? "Following" : "Follow"}
        </button>
      </section>

      <div className="feed-tabs profile-tabs" role="tablist" aria-label="Activity">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`profile-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="profile-panel"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "portfolio" && portfolioLocked && <LockIcon className="profile-tab-lock" />}
          </button>
        ))}
      </div>

      <div id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`}>
        {tab === "omens" && <OmensTab activity={activity} />}
        {tab === "comments" && <CommentsTab activity={activity} />}
        {tab === "trades" && <TradesTab trades={activity.trades} />}
        {tab === "portfolio" &&
          (portfolioLocked ? (
            <LockedPortfolio profile={profile} viewerRank={viewerRank} />
          ) : (
            <PortfolioTab portfolio={portfolio} />
          ))}
      </div>
    </div>
  );
}

function OmensTab({ activity }: { activity: ProfileActivity }) {
  if (activity.omens.length === 0) return <p className="muted feed-empty">No omens yet.</p>;
  return (
    <div className="feed-list feed-panel">
      {activity.omens.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function CommentsTab({ activity }: { activity: ProfileActivity }) {
  if (activity.comments.length === 0) return <p className="muted feed-empty">No comments yet.</p>;
  return (
    <div className="feed-list">
      {activity.comments.map(({ reply, post }) => (
        <article key={reply.id} className="profile-comment">
          <p className="profile-comment-context muted">
            Replying to <AuthorLink handle={post.handle} name={post.author} />
            <span className="profile-comment-snippet">“{post.content}”</span>
          </p>
          <p className="profile-comment-body">{reply.content}</p>
          <p className="profile-comment-meta muted">
            {reply.timestamp} · ♡ {reply.likes}
          </p>
        </article>
      ))}
    </div>
  );
}

function TradesTab({ trades }: { trades: ProfileTrade[] }) {
  if (trades.length === 0) return <p className="muted feed-empty">No trades yet.</p>;
  const states = trades.map(({ call }) => callTrack(call).state);
  const count = (...wanted: string[]) => states.filter((state) => wanted.includes(state)).length;
  const summary = [
    `${trades.length} ${trades.length === 1 ? "trade" : "trades"}`,
    count("fulfilled") && `${count("fulfilled")} fulfilled`,
    count("broken") && `${count("broken")} broken`,
    count("liquidated") && `${count("liquidated")} liquidated`,
    count("live", "doom") && `${count("live", "doom")} open`,
  ].filter(Boolean);
  return (
    <>
      <p className="profile-trade-summary muted">{summary.join(" · ")}</p>
      <div className="feed-list">
        {trades.map(({ post, call }) => (
          <div key={post.id} className="profile-trade">
            <span className="profile-trade-time muted">{post.timestamp}</span>
            <MarketCallCard call={call} />
          </div>
        ))}
      </div>
    </>
  );
}

function PortfolioTab({ portfolio }: { portfolio: ProfilePortfolio | null }) {
  if (!portfolio) return <p className="muted feed-empty">No active portfolio session.</p>;
  return (
    <section className="profile-portfolio">
      <div className="profile-portfolio-head">
        <div>
          <span className="eyebrow">24h session · ends in {portfolio.endsIn}</span>
          <strong className="profile-portfolio-equity">{usd.format(portfolio.equity)}</strong>
        </div>
        <span className={`profile-pnl ${portfolio.pnlPct >= 0 ? "is-up" : "is-down"}`}>{signedPct(portfolio.pnlPct)}</span>
      </div>
      <ul className="profile-lots">
        {portfolio.lots.map((lot) => (
          <li key={`${lot.symbol}-${lot.kind}`} className="profile-lot">
            <span className="profile-lot-icon" aria-hidden="true" style={{ background: avatarGradient(lot.symbol) }}>
              {lot.symbol[0]}
            </span>
            <strong>{lot.symbol}</strong>
            <span className="profile-lot-kind">
              {lot.kind === "spot" ? "Spot" : `${lot.leverage}× ${lot.side === "short" ? "Short" : "Long"}`}
            </span>
            <span className="profile-lot-value">{usd.format(lot.value)}</span>
            <span className={`profile-pnl ${lot.pnlPct >= 0 ? "is-up" : "is-down"}`}>{signedPct(lot.pnlPct)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Shown in place of the portfolio when the viewer ranks below the profile.
// The blurred rows behind the card are empty placeholders — the real
// portfolio was never sent (see app/profile/[handle]/page.tsx).
function LockedPortfolio({ profile, viewerRank }: { profile: Profile; viewerRank: string }) {
  return (
    <section className="profile-locked">
      <div className="profile-locked-preview" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="profile-lot profile-lot--ghost">
            <span className="profile-lot-icon" />
            <span />
            <span />
          </div>
        ))}
      </div>
      <div className="profile-locked-card">
        <LockIcon className="profile-locked-icon" />
        <h2>Portfolio locked</h2>
        <p className="muted">
          Only <RankBadge rank={profile.rank} seed={profile.handle} /> and above can see {profile.name}&rsquo;s portfolio.
          You&rsquo;re <RankBadge rank={viewerRank} seed="viewer" />.
        </p>
        <Link href="/duel" className="profile-locked-cta">
          Rank up in the Arena
        </Link>
      </div>
    </section>
  );
}
