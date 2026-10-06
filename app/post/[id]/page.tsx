import { notFound } from "next/navigation";
import { FeedSidebar } from "@/app/FeedSidebar";
import { EXCLUSIVE_POSTS, GLOBAL_POSTS, POST_REPLIES } from "@/app/lib/mockPosts";
import { PostThread } from "@/app/post/[id]/PostThread";

// A single post with its replies underneath, like an X status page or a
// Reddit thread. Reached by clicking a post (or its timestamp) in any feed.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = [...GLOBAL_POSTS, ...EXCLUSIVE_POSTS].find((candidate) => candidate.id === decodeURIComponent(id));
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
