import type { Market } from "@/app/lib/mockPosts";
import { LIVE_DUELS, TOP_TRADERS, TRENDING_CALLS } from "@/app/lib/sidebarMocks";

const MARKET_META: Record<Market, { symbol: string; symbolClass: string }> = {
  btc: { symbol: "₿", symbolClass: "btc-symbol" },
  eth: { symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { symbol: "Ð", symbolClass: "doge-symbol" },
};

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <section className="panel sidebar-panel">
        <h3>Live Duels</h3>
        {LIVE_DUELS.map((duel) => {
          const meta = MARKET_META[duel.market];
          return (
            <div className="sidebar-row" key={duel.id}>
              <div className="sidebar-row-main">
                <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
                <strong>{duel.players}</strong>
              </div>
              <span className="sidebar-value">{duel.timer}</span>
            </div>
          );
        })}
      </section>

      <section className="panel sidebar-panel">
        <h3>Trending Calls</h3>
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
        <h3>Top Traders</h3>
        {TOP_TRADERS.map((trader, index) => (
          <div className="sidebar-row" key={trader.id}>
            <div className="sidebar-row-main">
              <span className="sidebar-rank">{index + 1}</span>
              <strong>{trader.handle}</strong>
            </div>
            <span className="sidebar-value">{trader.winRate}</span>
          </div>
        ))}
      </section>
    </aside>
  );
}
