import { LiveArenaPanel } from "@/app/LiveArenaPanel";
import { OraclesLeaderboard } from "@/app/OraclesLeaderboard";
import { ProfitableCallsPanel } from "@/app/ProfitableCallsPanel";

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <OraclesLeaderboard />

      <ProfitableCallsPanel />

      <LiveArenaPanel />
    </aside>
  );
}
