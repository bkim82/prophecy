import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import { followedTraders } from "@/lib/follows";
import { getViewer } from "@/lib/viewer";

export default async function Page() {
  // The Following filter: the mock traders you follow. New accounts follow no one.
  const userId = (await getViewer())?.userId;
  const followed = userId ? await followedTraders(userId) : [];
  return (
    <main className="feed-shell feed-shell--nav">
      <FeedSwitcher posts={GLOBAL_POSTS} followed={followed} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
