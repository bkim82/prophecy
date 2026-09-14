import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS, LIVE_DUEL_COUNT, LIVE_PLAYER_COUNT } from "@/app/lib/mockPosts";

export default function Page() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <section className="feed-heading">
          <h1 className="display-font">Omens</h1>
        </section>
        <div className="feed-pulse-strip">
          <span className="status-dot is-online" aria-hidden="true" />
          {LIVE_PLAYER_COUNT.toLocaleString()} online · {LIVE_DUEL_COUNT} duels live
        </div>
        <FeedSwitcher posts={GLOBAL_POSTS} />
      </div>
      <FeedSidebar />
    </main>
  );
}
