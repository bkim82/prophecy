import { notFound } from "next/navigation";
import { FeedSidebar } from "@/app/FeedSidebar";
import { EXCLUSIVE_POSTS, GLOBAL_POSTS, POST_REPLIES } from "@/app/lib/mockPosts";
import { PostThread } from "@/app/post/[id]/PostThread";
import { repliesFor, withEngagement } from "@/lib/engagement";
import { savedPost } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

// A single post with its replies underneath, like an X status page or a
// Reddit thread. Reached by clicking a post (or its timestamp) in any feed.
// Mock posts come from app/lib/mockPosts.ts; anything else is looked up in
// the `posts` table (lib/posts.ts savedPost). Likes, reposts and replies
// come from lib/engagement.ts; without it the mock thread still shows.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const viewerId = (await getViewer())?.userId ?? null;
  const mock = [...GLOBAL_POSTS, ...EXCLUSIVE_POSTS].find((candidate) => candidate.id === id);
  const found = mock ?? (await savedPost(id, viewerId).catch(() => null));
  if (!found) notFound();
  const [[post], replies] = await Promise.all([
    withEngagement([found], viewerId),
    repliesFor(found.id, viewerId).catch((error: unknown) => {
      console.error("Replies unavailable", error);
      return POST_REPLIES[found.id] ?? [];
    }),
  ]);

  return (
    <main className="feed-shell">
      <div className="feed-main">
        <PostThread post={post} replies={replies} />
      </div>
      <FeedSidebar />
    </main>
  );
}
