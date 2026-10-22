import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import { followedReshares, withEngagement } from "@/lib/engagement";
import { followedHandles } from "@/lib/follows";
import { feedPosts, savedPostsByIds } from "@/lib/posts";
import { accountTopics } from "@/lib/topicPrefs";
import { getViewer } from "@/lib/viewer";

export default async function Page() {
  const userId = (await getViewer())?.userId ?? null;
  // The Following filter: everyone you follow (mock traders and real
  // accounts), plus what the real ones reposted. New accounts follow no one.
  const [followed, shares] = userId
    ? await Promise.all([
        followedHandles(userId),
        followedReshares(userId).catch((error: unknown) => {
          console.error("Followed reposts unavailable", error);
          return [];
        }),
      ])
    : [[], []];
  // Saved omens sit above the mock feed. Before db/posts.sql is applied (or
  // during a DB outage) the feed just shows the mock posts.
  const saved = await feedPosts(userId).catch((error: unknown) => {
    console.error("Saved posts unavailable", error);
    return [];
  });
  // A reposted saved post older than the newest 30 joins the rest of the feed
  // (not pinned), so its repost has a post to sit on.
  const sharedIds = shares.map((share) => share.postId).filter((id) => !saved.some((post) => post.id === id));
  const older = await savedPostsByIds([...new Set(sharedIds)], userId).catch(() => []);
  // Saved likes, reposts, replies and clash votes on all of it, in one round of queries.
  const posts = await withEngagement([...saved, ...GLOBAL_POSTS, ...older], userId);
  // Followed / Not interested / inferred topics. Before db/topics.sql is
  // applied the feed falls back to this browser's lists.
  const topics = userId
    ? await accountTopics(userId).catch((error: unknown) => {
        console.error("Account topics unavailable", error);
        return null;
      })
    : null;
  return (
    <main className="feed-shell feed-shell--nav">
      <FeedSwitcher posts={posts.slice(saved.length)} savedPosts={posts.slice(0, saved.length)} followed={followed} shares={shares} account={topics} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
