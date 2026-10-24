import { FeedSidebar } from "@/app/FeedSidebar";

// Rank gate temporarily disabled while iterating on the feed look — see
// app/lib/rank.ts and docs/roadmap.md "Not built" for the real gate. There's
// no way to post here yet, so the feed is empty.
export default function Page() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <section className="feed-heading">
          <span className="eyebrow">Exclusive</span>
          <h1 className="display-font">Omens</h1>
          <span className="muted">Unlocked by rank</span>
        </section>

        <div className="feed-list feed-panel">
          <p className="muted feed-empty">Nothing here yet.</p>
        </div>
      </div>
      <FeedSidebar />
    </main>
  );
}
