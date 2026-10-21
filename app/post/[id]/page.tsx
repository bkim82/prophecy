import { notFound } from "next/navigation";
import { FeedSidebar } from "@/app/FeedSidebar";
import { EXCLUSIVE_POSTS, GLOBAL_POSTS, POST_REPLIES } from "@/app/lib/mockPosts";
import { PostThread } from "@/app/post/[id]/PostThread";
import { savedPost } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

// A single post with its replies underneath, like an X status page or a
// Reddit thread. Reached by clicking a post (or its timestamp) in any feed.
// Mock posts come from app/lib/mockPosts.ts; anything else is looked up in
// the `posts` table (lib/posts.ts savedPost). Saved posts have no stored
// replies yet, so their thread starts empty.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const mock = [...GLOBAL_POSTS, ...EXCLUSIVE_POSTS].find((candidate) => candidate.id === id);
  const post = mock ?? (await savedPost(id, (await getViewer())?.userId ?? null).catch(() => null));
  if (!post) notFound();

  return (
    <main className="feed-shell">
      <div className="feed-main">
        <PostThread post={post} replies={POST_REPLIES[post.id] ?? []} />
      </div>
      <FeedSidebar />
    </main>
  );
}
