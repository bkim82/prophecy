"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AuthorLink } from "@/app/AuthorLink";
import { ArenaIcon, ContrarianIcon, DaredevilIcon, FlameIcon, LinkIcon, LockIcon, PatientIcon, PinIcon, SwiftIcon, TrendIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { callTrack } from "@/app/lib/calls";
import type { ProfilePortfolio } from "@/app/lib/mockPortfolios";
import type { Profile, ProfileActivity, ProfileTrade } from "@/app/lib/mockProfiles";
import type { CopyEarnings } from "@/app/lib/mockViewer";
import { bannerBackground, websiteLabel } from "@/app/lib/profileEdit";
import {
  ARCHETYPES,
  ASSET_META,
  MAX_PINS,
  accuracyLine,
  accuracyTone,
  isPinnableMatch,
  signatureAsset,
  type ArchetypeId,
  type AssetAccuracy,
} from "@/app/lib/profileTraits";
import { togglePinnedMatch } from "@/app/profile/actions";
import { EditProfileDialog, type EditableProfile } from "@/app/profile/EditProfileDialog";
import type { MatchHistoryEntry, MatchRecord } from "@/lib/match";
import { rankTier } from "@/app/lib/rank";
import { ChallengeControl, type ChallengeState } from "@/app/profile/[handle]/ChallengeDialog";
import { cancelChallenge } from "@/app/profile/challengeActions";
import { MarketCallCard, PostCard } from "@/app/PostCard";
import { RankBadge } from "@/app/RankBadge";

type TabId = "matches" | "omens" | "comments" | "trades" | "portfolio";

const TABS: { id: TabId; label: string }[] = [
  { id: "omens", label: "Omens" },
  { id: "comments", label: "Comments" },
  { id: "trades", label: "Trades" },
  { id: "portfolio", label: "Portfolio" },
];

// Own profile only, ahead of the shared tabs.
const SELF_TABS: { id: TabId; label: string }[] = [{ id: "matches", label: "Matches" }, ...TABS];

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usdCents.format(Math.abs(n))}`;
const signedCount = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
const roundLength = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

// A settled match plus what the server resolved for display: the opponent's
// Clerk name and a relative time (formatted server-side so SSR and hydration agree).
export type ProfileMatch = MatchHistoryEntry & { opponentName: string; playedLabel: string };

export type OwnProfile = {
  matches: ProfileMatch[];
  record: MatchRecord;
  copyEarnings: CopyEarnings;
  edit: EditableProfile;
  pinnedMatchIds: string[];
  challenges: SentChallenge[];
};

// A pending challenge you sent, resolved for display (target name/rank from
// their profile, `terms` from challengeTerms, relative `sentLabel`).
export type SentChallenge = { id: string; handle: string; name: string; rank: string; href?: string; terms: string; sentLabel: string };

// The hero's "how they trade" line. `accuracySource` explains where the
// numbers come from when it isn't obvious (your own: Arena round P&L).
export type ProfileTraits = { accuracy: AssetAccuracy[]; archetype: ArchetypeId | null; accuracySource?: string };

const ARCHETYPE_ICONS: Record<ArchetypeId, (props: { className?: string }) => React.JSX.Element> = {
  swift: SwiftIcon,
  patient: PatientIcon,
  contrarian: ContrarianIcon,
  daredevil: DaredevilIcon,
};

type ProfileViewProps = {
  profile: Profile;
  activity: ProfileActivity;
  // null when locked (never sent) or when this user has no session.
  portfolio: ProfilePortfolio | null;
  portfolioLocked: boolean;
  viewerRank: string;
  initiallyFollowing: boolean;
  traits: ProfileTraits;
  // Someone else's profile only: which Challenge button to show.
  challenge?: ChallengeState;
  // Set on /profile (the signed-in viewer's own page): Edit profile in place
  // of Follow, copy earnings under the hero, and a Matches tab with Pin
  // buttons (the highlight reel itself lives in the rail, HighlightReel.tsx).
  self?: OwnProfile;
};

export function ProfileView({ profile, activity, portfolio, portfolioLocked, viewerRank, initiallyFollowing, traits, challenge, self }: ProfileViewProps) {
  const [tab, setTab] = useState<TabId>(self ? "matches" : "omens");
  const [editing, setEditing] = useState(false);
  // Own profiles may have no handle yet; the page supplies a stable seed instead.
  const seed = self?.edit.avatarSeed ?? profile.handle;
  const [following, setFollowing] = useState(initiallyFollowing);
  // Local-only follow toggle, like the feed's like button — nothing persists.
  const followers = profile.followers + Number(following) - Number(initiallyFollowing);
  const [pinPendingId, setPinPendingId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [, startPin] = useTransition();
  const Archetype = traits.archetype ? ARCHETYPE_ICONS[traits.archetype] : null;

  // Pin/unpin from the Matches tab; the action refreshes the page, so the rail's reel updates too.
  const togglePin = (id: string) => {
    setPinPendingId(id);
    setPinError(null);
    startPin(async () => {
      try {
        const result = await togglePinnedMatch(id);
        if (!result.ok) setPinError(result.error);
      } catch {
        setPinError("Couldn't update your pins — try again.");
      }
      setPinPendingId(null);
    });
  };

  return (
    <div className="feed-main">
      <section className={`profile-hero${profile.banner ? " has-banner" : ""}`} data-rank={rankTier(profile.rank)}>
        {profile.banner && <div className="profile-banner" aria-hidden="true" style={{ background: bannerBackground(profile.banner) }} />}
        <div className="profile-avatar" aria-hidden="true" style={{ background: avatarGradient(seed) }}>
          {/* Clerk-hosted; a plain img avoids allow-listing its domain for next/image. */}
          {profile.imageUrl ? <img src={profile.imageUrl} alt="" /> : profile.avatarInitial}
        </div>
        {/* Opaque backing so the avatar doesn't show through the translucent badge it overlaps. */}
        <span className="profile-rank">
          <RankBadge rank={profile.rank} seed={seed} size="lg" />
        </span>
        <div className="profile-identity">
          <h1>{profile.name}</h1>
          {profile.handle ? (
            <span className="muted">{profile.handle}</span>
          ) : (
            self && (
              <button type="button" className="profile-handle-prompt" onClick={() => setEditing(true)}>
                Choose your @handle
              </button>
            )
          )}
        </div>
        {traits.archetype && Archetype && (
          <p className="profile-archetype" data-archetype={traits.archetype}>
            <Archetype />
            <strong>{ARCHETYPES[traits.archetype].name}</strong>
            <span className="muted">{ARCHETYPES[traits.archetype].blurb}</span>
          </p>
        )}
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {(profile.location || profile.website) && (
          <p className="profile-meta">
            {profile.location && (
              <span>
                <PinIcon />
                {profile.location}
              </span>
            )}
            {profile.website && (
              // User-supplied link: only ever http(s) (normalizeWebsite), and nofollow/ugc.
              <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow ugc">
                <LinkIcon />
                {websiteLabel(profile.website)}
              </a>
            )}
          </p>
        )}
        <p className="profile-stats">
          <span>Joined {profile.joined}</span>
          <span>
            <strong>{compactCount.format(followers).toLowerCase()}</strong> Followers
          </span>
          <span>
            <strong>{compactCount.format(profile.following).toLowerCase()}</strong> Following
          </span>
        </p>
        {traits.accuracy.length > 0 && <TradeDossier accuracy={traits.accuracy} source={traits.accuracySource} />}
        {self ? (
          <button type="button" className="profile-follow is-following" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        ) : (
          <ChallengeControl state={challenge ?? { kind: "ready" }} target={{ handle: profile.handle, name: profile.name, rank: profile.rank }} viewerRank={viewerRank}>
            <button
              type="button"
              className={`profile-follow${following ? " is-following" : ""}`}
              aria-pressed={following}
              onClick={() => setFollowing((v) => !v)}
            >
              {following ? "Following" : "Follow"}
            </button>
          </ChallengeControl>
        )}
      </section>

      {self && <CopyEarningsCard earnings={self.copyEarnings} />}
      {self && editing && <EditProfileDialog initial={self.edit} onClose={() => setEditing(false)} />}

      <div className="feed-tabs profile-tabs" role="tablist" aria-label="Activity">
        {(self ? SELF_TABS : TABS).map(({ id, label }) => (
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
        {tab === "matches" && self && (
          <>
            {pinError && (
              <p className="profile-pin-error" role="alert">
                {pinError}
              </p>
            )}
            <SentChallenges challenges={self.challenges} />
            <MatchesTab matches={self.matches} record={self.record} pinnedIds={self.pinnedMatchIds} pendingId={pinPendingId} onTogglePin={togglePin} />
          </>
        )}
        {tab === "omens" && <OmensTab activity={activity} />}
        {tab === "comments" && <CommentsTab activity={activity} />}
        {tab === "trades" && <TradesTab trades={activity.trades} />}
        {tab === "portfolio" &&
          (self ? (
            <p className="muted feed-empty">
              Your live 24h session is in the Arena.{" "}
              <Link href="/duel/portfolio" className="profile-empty-link">
                Open Portfolio →
              </Link>
            </p>
          ) : portfolioLocked ? (
            <LockedPortfolio profile={profile} viewerRank={viewerRank} />
          ) : (
            <PortfolioTab portfolio={portfolio} />
          ))}
      </div>
    </div>
  );
}

// Signature asset (most calls) + top-three accuracy, e.g. "BTC 78% · SOL 61% · ETH 40%".
function TradeDossier({ accuracy, source }: { accuracy: AssetAccuracy[]; source?: string }) {
  const signature = signatureAsset(accuracy);
  const meta = signature && ASSET_META[signature.asset];
  return (
    <div className="profile-dossier">
      {signature && (
        <span className="profile-dossier-item">
          <span className="eyebrow">Signature</span>
          {meta && (
            <span className={`market-symbol ${meta.symbolClass}`} aria-hidden="true">
              {meta.symbol}
            </span>
          )}
          <strong>{signature.asset}</strong>
        </span>
      )}
      <span className="profile-dossier-item" title={source}>
        <span className="eyebrow">Accuracy</span>
        <span>
          {accuracyLine(accuracy).map((row, i) => (
            <span key={row.asset}>
              {i > 0 && <span className="muted"> · </span>}
              {row.asset} <strong className={accuracyTone(row.accuracy)}>{Math.round(row.accuracy * 100)}%</strong>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

// How much the viewer made from other traders copying them — mock numbers
// (app/lib/mockViewer.ts), nothing is actually copied yet.
function CopyEarningsCard({ earnings }: { earnings: CopyEarnings }) {
  return (
    <section className="profile-copy" aria-label="Copy trading">
      <div className="profile-copy-head">
        <TrendIcon />
        <span className="eyebrow">Copy trading</span>
      </div>
      <dl className="profile-copy-stats">
        <div>
          <dt>Traders copied you</dt>
          <dd>{earnings.copiers.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Trades copied</dt>
          <dd>{earnings.copies.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Earned from copies</dt>
          <dd className="is-up">{usdCents.format(earnings.earned)}</dd>
        </div>
      </dl>
    </section>
  );
}

// Challenges you've sent that are still waiting, above your match history.
function SentChallenges({ challenges }: { challenges: SentChallenge[] }) {
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startCancel] = useTransition();
  if (challenges.length === 0) return null;

  const cancel = (id: string) => {
    setCancelingId(id);
    setError(null);
    startCancel(async () => {
      const result = await cancelChallenge(id).catch(() => ({ ok: false as const, error: "Couldn't cancel — try again." }));
      if (!result.ok) setError(result.error);
      setCancelingId(null);
    });
  };

  return (
    <section className="profile-sent" aria-label="Sent challenges">
      <p className="profile-trade-summary muted">
        {challenges.length} pending {challenges.length === 1 ? "challenge" : "challenges"}
      </p>
      <ul className="profile-matches">
        {challenges.map((challenge) => (
          <li key={challenge.id} className="profile-match profile-sent-row">
            <span className="profile-match-result profile-sent-icon" aria-hidden="true">
              <ArenaIcon />
            </span>
            <div className="profile-match-main">
              <strong>
                vs {challenge.href ? <Link href={challenge.href}>{challenge.name}</Link> : challenge.name}{" "}
                <RankBadge rank={challenge.rank} seed={challenge.handle} />
              </strong>
              <span className="muted">
                {challenge.terms} · sent {challenge.sentLabel}
              </span>
            </div>
            <span className="profile-sent-status">Pending</span>
            <div className="profile-match-pin">
              <button type="button" className="profile-pin" disabled={cancelingId === challenge.id} onClick={() => cancel(challenge.id)}>
                {cancelingId === challenge.id ? "…" : "Cancel"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="profile-pin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

type MatchesTabProps = {
  matches: ProfileMatch[];
  record: MatchRecord;
  pinnedIds: string[];
  pendingId: string | null;
  onTogglePin: (id: string) => void;
};

function MatchesTab({ matches, record, pinnedIds, pendingId, onTogglePin }: MatchesTabProps) {
  const full = pinnedIds.length >= MAX_PINS;
  if (matches.length === 0) {
    return (
      <p className="muted feed-empty">
        No matches yet.{" "}
        <Link href="/duel" className="profile-empty-link">
          Play a round in the Arena →
        </Link>
      </p>
    );
  }
  const summary = [
    `${record.played} ${record.played === 1 ? "match" : "matches"}`,
    `${record.won}W · ${record.lost}L${record.tied ? ` · ${record.tied}T` : ""}`,
    `${signedCount(record.net)} Embers`,
    record.played > matches.length && `last ${matches.length} shown`,
  ].filter(Boolean);
  return (
    <>
      <p className="profile-trade-summary muted">{summary.join(" · ")}</p>
      <ul className="profile-matches">
        {matches.map((match) => (
          <li key={match.id} className="profile-match" data-result={match.result}>
            <span className="profile-match-result" aria-hidden="true">
              {match.result === "won" ? "W" : match.result === "lost" ? "L" : "T"}
            </span>
            <div className="profile-match-main">
              <strong>
                <span className="sr-only">{match.result === "won" ? "Won" : match.result === "lost" ? "Lost" : "Tied"} </span>vs{" "}
                {match.opponentName}
              </strong>
              <span className="muted">
                {match.market.toUpperCase()} · {roundLength(match.timerSeconds)} round · {match.wager} Ember stake · {match.playedLabel}
              </span>
            </div>
            <div className="profile-match-side">
              <strong className="profile-match-net">
                {signedCount(match.net)} <FlameIcon />
              </strong>
              {match.yourProfit !== null && (
                <span className="muted">
                  {signedUsd(match.yourProfit)} vs {signedUsd(match.opponentProfit ?? 0)}
                </span>
              )}
            </div>
            <div className="profile-match-pin">
              {isPinnableMatch(match) && (
                <PinButton
                  pinned={pinnedIds.includes(match.id)}
                  full={full}
                  pending={pendingId === match.id}
                  onClick={() => onTogglePin(match.id)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function PinButton({ pinned, full, pending, onClick }: { pinned: boolean; full: boolean; pending: boolean; onClick: () => void }) {
  const blocked = !pinned && full;
  return (
    <button
      type="button"
      className={`profile-pin${pinned ? " is-pinned" : ""}`}
      aria-pressed={pinned}
      disabled={pending || blocked}
      title={blocked ? `Unpin one first — ${MAX_PINS} max` : pinned ? "Unpin from your highlight reel" : "Pin to your highlight reel"}
      onClick={onClick}
    >
      <span aria-hidden="true">✦</span>
      <span className="profile-pin-label">{pending ? "…" : pinned ? "Pinned" : "Pin"}</span>
    </button>
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
