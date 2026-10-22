import { LiveArenaPanel } from "@/app/LiveArenaPanel";
import { OraclesLeaderboard } from "@/app/OraclesLeaderboard";
import { ProfitableCallsPanel } from "@/app/ProfitableCallsPanel";
import { SidebarSearch } from "@/app/SidebarSearch";

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <SidebarSearch />

      <OraclesLeaderboard />

      <ProfitableCallsPanel />

      <LiveArenaPanel />
    </aside>
  );
}
