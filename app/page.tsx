import { FeedSidebar } from "@/app/FeedSidebar";
import { FeedSwitcher } from "@/app/FeedSwitcher";
import { GLOBAL_POSTS, type Post } from "@/app/lib/mockPosts";
import { blockedHandlesFor } from "@/lib/blocks";
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
  // during a DB outage) the feed just shows the mock posts. Nothing from
  // anyone with a block either way between you (lib/blocks.ts).
  const [allSaved, blocked] = await Promise.all([
    feedPosts(userId).catch((error: unknown) => {
      console.error("Saved posts unavailable", error);
      return [];
    }),
    userId
      ? blockedHandlesFor(userId).catch((error: unknown) => {
          console.error("Blocks unavailable", error);
          return new Set<string>();
        })
      : new Set<string>(),
  ]);
  const hidden = new Set<string>();
  const visible = (post: Post) => {
    if (blocked.has(post.handle)) hidden.add(post.id);
    return !hidden.has(post.id);
  };
  const saved = allSaved.filter(visible);
  // A reposted saved post older than the newest 30 joins the rest of the feed
  // (not pinned), so its repost has a post to sit on.
  const sharedIds = shares.map((share) => share.postId).filter((id) => !allSaved.some((post) => post.id === id));
  const older = (await savedPostsByIds([...new Set(sharedIds)], userId).catch(() => [])).filter(visible);
  // A followed account's repost of a hidden post goes with it.
  const reposts = shares.filter((share) => !hidden.has(share.postId));
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
      <FeedSwitcher posts={posts.slice(saved.length)} savedPosts={posts.slice(0, saved.length)} followed={followed} shares={reposts} account={topics} />
      <aside className="feed-sidebar">
        <FeedSidebar />
      </aside>
    </main>
  );
}
