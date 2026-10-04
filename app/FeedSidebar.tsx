import { LiveArenaPanel } from "@/app/LiveArenaPanel";
import { ProfitableCallsPanel } from "@/app/ProfitableCallsPanel";
import type { Market } from "@/app/lib/mockPosts";
import { LIVE_ARENAS } from "@/app/lib/sidebarMocks";

const MARKET_META: Record<Market, { symbol: string; symbolClass: string }> = {
  btc: { symbol: "₿", symbolClass: "btc-symbol" },
  eth: { symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { symbol: "Ð", symbolClass: "doge-symbol" },
};

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <section className="panel sidebar-panel">
        <h3>Leaderboard</h3>
        {LIVE_ARENAS.map((arena) => {
          const meta = MARKET_META[arena.market];
          return (
            <div className="sidebar-row" key={arena.id}>
              <div className="sidebar-row-main">
                <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
                <strong>{arena.players}</strong>
              </div>
              <span className="sidebar-value">{arena.timer}</span>
            </div>
          );
        })}
      </section>

      <ProfitableCallsPanel />

      <LiveArenaPanel />
    </aside>
  );
}
