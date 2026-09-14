import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { WalletDesk } from "@/app/WalletDesk";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";

export default function Page() {
  return (
    <main className="feed-shell">
      <div className="feed-main">
        <FeedSwitcher posts={GLOBAL_POSTS} />
      </div>
      <aside className="feed-sidebar">
        <WalletDesk showConnection={false} />
        <FeedSidebar />
      </aside>
    </main>
  );
}
