import { FeedSidebar } from "@/app/FeedSidebar";
import { PostCard } from "@/app/PostCard";
import { EXCLUSIVE_POSTS } from "@/app/lib/mockPosts";

// Rank gate temporarily disabled while iterating on the feed look — see
// app/lib/rank.ts and docs/roadmap.md "Not built" for the real gate.
export default function Page() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <section className="feed-heading">
          <span className="eyebrow">Exclusive</span>
          <h1 className="display-font">Feed</h1>
          <span className="muted">Unlocked by rank</span>
        </section>

        <div className="feed-list">
          {EXCLUSIVE_POSTS.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </div>
      <FeedSidebar />
    </main>
  );
}
