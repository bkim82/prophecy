import type { Market } from "@/app/lib/mockPosts";
import { TRENDING_CALLS, TRENDING_PROPHECIES } from "@/app/lib/sidebarMocks";
import { OraclesLeaderboard } from "@/app/OraclesLeaderboard";

const MARKET_META: Record<Market, { symbol: string; symbolClass: string }> = {
  btc: { symbol: "₿", symbolClass: "btc-symbol" },
  eth: { symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { symbol: "Ð", symbolClass: "doge-symbol" },
};

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <OraclesLeaderboard />

      <section className="panel sidebar-panel">
        <h3>Most Profitable Calls</h3>
        {TRENDING_CALLS.map((call) => {
          const meta = MARKET_META[call.market];
          const isUp = call.changePct >= 0;
          return (
            <div className="sidebar-row" key={call.id}>
              <div className="sidebar-row-main">
                <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
                <strong>{call.handle}</strong>
              </div>
              <span className={`sidebar-value ${isUp ? "is-up" : "is-down"}`}>
                {call.side} {isUp ? "+" : ""}
                {call.changePct}%
              </span>
            </div>
          );
        })}
      </section>

      <section className="panel sidebar-panel">
        <h3>Trending Prophecie</h3>
        {TRENDING_PROPHECIES.map((post) => (
          <div className="sidebar-row sidebar-row--prophecy" key={post.id}>
            <div className="sidebar-row-main">
              <span className="sidebar-avatar">{post.avatarInitial}</span>
              <strong>{post.handle}</strong>
            </div>
            <p className="sidebar-prophecy-content">{post.content}</p>
          </div>
        ))}
      </section>
    </aside>
  );
}
