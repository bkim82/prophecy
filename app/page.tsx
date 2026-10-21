import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import { feedPosts } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

export default async function Page() {
  const viewer = await getViewer();
  // Saved omens sit above the mock feed. Before db/posts.sql is applied (or
  // during a DB outage) the feed just shows the mock posts.
  const savedPosts = await feedPosts(viewer?.userId ?? null).catch((error: unknown) => {
    console.error("Saved posts unavailable", error);
    return [];
  });
  return (
    <main className="feed-shell feed-shell--nav">
      <FeedSwitcher posts={GLOBAL_POSTS} savedPosts={savedPosts} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
