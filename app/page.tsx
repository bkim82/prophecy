import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import { followedTraders } from "@/lib/follows";
import { feedPosts } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

export default async function Page() {
  const userId = (await getViewer())?.userId ?? null;
  // The Following filter: the mock traders you follow. New accounts follow no one.
  const followed = userId ? await followedTraders(userId) : [];
  // Saved omens sit above the mock feed. Before db/posts.sql is applied (or
  // during a DB outage) the feed just shows the mock posts.
  const savedPosts = await feedPosts(userId).catch((error: unknown) => {
    console.error("Saved posts unavailable", error);
    return [];
  });
  return (
    <main className="feed-shell feed-shell--nav">
      <FeedSwitcher posts={GLOBAL_POSTS} savedPosts={savedPosts} followed={followed} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
