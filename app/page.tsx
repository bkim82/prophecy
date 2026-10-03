import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";

export default function Page() {
  return (
    <main className="feed-shell feed-shell--nav">
      <FeedSwitcher posts={GLOBAL_POSTS} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
