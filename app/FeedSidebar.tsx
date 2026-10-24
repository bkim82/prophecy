import { Suspense } from "react";
import { LiveArenaPanel } from "@/app/LiveArenaPanel";
import { OraclesLeaderboard } from "@/app/OraclesLeaderboard";
import { ProfitableCallsPanel } from "@/app/ProfitableCallsPanel";
import { SidebarSearch } from "@/app/SidebarSearch";
import { sidebarBoards } from "@/lib/sidebar";

export function FeedSidebar() {
  return (
    <aside className="feed-sidebar">
      <SidebarSearch />

      {/* Streamed in after the page, so the feed never waits on the boards. */}
      <Suspense fallback={null}>
        <Boards />
      </Suspense>
    </aside>
  );
}

// Each panel renders nothing while it has nothing to show.
async function Boards() {
  const { leaders, calls, arenas } = await sidebarBoards();
  return (
    <>
      <OraclesLeaderboard leaders={leaders} />

      <ProfitableCallsPanel calls={calls} />

      <LiveArenaPanel arenas={arenas} />
    </>
  );
}
