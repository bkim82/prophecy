import { signedPct } from "@/app/lib/calls";
import type { Market } from "@/app/lib/mockPosts";
import type { ProfileRecords } from "@/app/lib/mockAchievements";
import { rankTier } from "@/app/lib/rank";
import { RankBadge } from "@/app/RankBadge";

// Right rail on /profile/[handle] and /profile, in place of the feed's
// FeedSidebar: the profile's records (peak Elo, biggest-ROI trade, …). The
// trophy case it used to carry became the highlight reel (HighlightReel.tsx).

const MARKET_META: Record<Market, { label: string; symbol: string; symbolClass: string }> = {
  btc: { label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  eth: { label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
};

const count = new Intl.NumberFormat("en-US");

export function ProfileAchievements({ records, seed }: { records: ProfileRecords | null; seed: string }) {
  if (!records) {
    return (
      <aside className="feed-sidebar">
        <section className="panel sidebar-panel">
          <h3>Achievements</h3>
          <p className="muted profile-records-empty">No records yet.</p>
        </section>
      </aside>
    );
  }

  const { bestTrade } = records;
  const market = MARKET_META[bestTrade.market];

  return (
    <aside className="feed-sidebar">
      <section className="panel sidebar-panel profile-records">
        <h3>Achievements</h3>
        <div className="profile-record-heroes">
          <div className="profile-record-hero" data-rank={rankTier(records.peakRank)}>
            <span className="eyebrow">Highest Elo</span>
            <strong className="profile-record-big">{count.format(records.peakElo)}</strong>
            <RankBadge rank={records.peakRank} seed={seed} />
          </div>
          <div className="profile-record-hero">
            <span className="eyebrow">Biggest ROI</span>
            <strong className={`profile-record-big ${bestTrade.roi >= 0 ? "is-up" : "is-down"}`}>{signedPct(bestTrade.roi)}</strong>
            <span className="profile-record-trade">
              <span className={`market-symbol ${market.symbolClass}`} aria-hidden="true">
                {market.symbol}
              </span>
              {market.label} {bestTrade.side === "LONG" ? "↑" : "↓"} {bestTrade.leverage}×
            </span>
            <span className="profile-record-date muted">{bestTrade.date}</span>
          </div>
        </div>
        <dl className="profile-record-list">
          <div className="sidebar-row">
            <dt>Longest win streak</dt>
            <dd className="sidebar-value">{records.longestStreak} calls</dd>
          </div>
          <div className="sidebar-row">
            <dt>Win rate</dt>
            <dd className="sidebar-value">
              {Math.round(records.winRate * 100)}% <span className="muted">of {count.format(records.calls)}</span>
            </dd>
          </div>
          <div className="sidebar-row">
            <dt>Best 24h session</dt>
            <dd className={`sidebar-value ${records.bestSession >= 0 ? "is-up" : "is-down"}`}>{signedPct(records.bestSession)}</dd>
          </div>
          <div className="sidebar-row">
            <dt>Arena duels won</dt>
            <dd className="sidebar-value">{count.format(records.duelsWon)}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
