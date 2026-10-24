import { signedPct } from "@/app/lib/calls";
import type { Market } from "@/app/lib/posts";
import type { ProfileRecords } from "@/app/lib/profileTraits";
import { rankTier } from "@/app/lib/rank";
import { RankBadge } from "@/app/RankBadge";

// Right rail on /profile/[handle] and /profile, in place of the feed's
// FeedSidebar: the profile's records (peak Elo, biggest-ROI trade, …; real
// accounts' from lib/activity.ts, "—" where there's nothing yet), then
// whatever the page stacks under it (the highlight reel, HighlightReel.tsx).
// ≤768px the rail is hidden and AchievementsPanel shows as a face of the
// profile hero instead (ProfileShowcase.tsx).

const MARKET_META: Record<Market, { label: string; symbol: string; symbolClass: string }> = {
  btc: { label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  eth: { label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
  sol: { label: "SOL", symbol: "◎", symbolClass: "sol-symbol" },
};

const count = new Intl.NumberFormat("en-US");

// `children` = panels stacked under Achievements (the highlight reel).
export function ProfileAchievements({ records, seed, children }: { records: ProfileRecords | null; seed: string; children?: React.ReactNode }) {
  return (
    <aside className="feed-sidebar profile-rail">
      <AchievementsPanel records={records} seed={seed} />
      {children}
    </aside>
  );
}

export function AchievementsPanel({ records, seed }: { records: ProfileRecords | null; seed: string }) {
  if (!records) {
    return (
      <section className="panel sidebar-panel">
        <h3>Achievements</h3>
        <p className="muted profile-records-empty">No records yet.</p>
      </section>
    );
  }

  const { bestTrade, bestSession, winRate } = records;
  // Portfolio tokens and Pulse markets outside MARKET_META show their symbol without a glyph.
  const market = bestTrade && (MARKET_META[bestTrade.market as Market] ?? { label: bestTrade.market.toUpperCase(), symbol: null, symbolClass: "" });
  const unit = records.unit ?? "calls";

  return (
    <section className="panel sidebar-panel profile-records">
      <h3>Achievements</h3>
      <div className="profile-record-heroes">
        <div className="profile-record-hero" data-rank={rankTier(records.peakRank)}>
          <span className="eyebrow">{records.peakElo === null ? "Peak rank" : "Highest Elo"}</span>
          {records.peakElo !== null && <strong className="profile-record-big">{count.format(records.peakElo)}</strong>}
          <RankBadge rank={records.peakRank} seed={seed} />
        </div>
        <div className="profile-record-hero">
          <span className="eyebrow">Biggest ROI</span>
          {bestTrade && market ? (
            <>
              <strong className={`profile-record-big ${bestTrade.roi >= 0 ? "is-up" : "is-down"}`}>{signedPct(bestTrade.roi)}</strong>
              <span className="profile-record-trade">
                {market.symbol && (
                  <span className={`market-symbol ${market.symbolClass}`} aria-hidden="true">
                    {market.symbol}
                  </span>
                )}
                {market.label}{" "}
                {bestTrade.side && bestTrade.leverage ? `${bestTrade.side === "LONG" ? "↑" : "↓"} ${bestTrade.leverage}×` : "Pulse round"}
              </span>
              <span className="profile-record-date muted">{bestTrade.date}</span>
            </>
          ) : (
            <>
              <strong className="profile-record-big">—</strong>
              <span className="profile-record-date muted">No closed trades yet</span>
            </>
          )}
        </div>
      </div>
      <dl className="profile-record-list">
        <div className="sidebar-row">
          <dt>Longest win streak</dt>
          <dd className="sidebar-value">
            {records.longestStreak} {unit}
          </dd>
        </div>
        <div className="sidebar-row">
          <dt>Win rate</dt>
          <dd className="sidebar-value">
            {winRate === null ? "—" : `${Math.round(winRate * 100)}%`} <span className="muted">of {count.format(records.calls)}{unit === "rounds" ? " rounds" : ""}</span>
          </dd>
        </div>
        <div className="sidebar-row">
          <dt>Best 24h session</dt>
          <dd className={`sidebar-value${bestSession === null ? "" : bestSession >= 0 ? " is-up" : " is-down"}`}>{bestSession === null ? "—" : signedPct(bestSession)}</dd>
        </div>
        <div className="sidebar-row">
          <dt>Arena duels won</dt>
          <dd className="sidebar-value">{count.format(records.duelsWon)}</dd>
        </div>
      </dl>
    </section>
  );
}
