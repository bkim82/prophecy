import { authorFor } from "@/app/api/posts/author";
import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { isBlockedEitherWay } from "@/lib/blocks";
import { createReply, engagementTarget, replyCountSince, repliesFor } from "@/lib/engagement";
import { MAX_POST_CHARS } from "@/lib/postInput";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const PER_MINUTE = 10;
const PER_DAY = 300;

/** GET → { replies }: a post's saved replies (newest first) then its mock thread, as the viewer sees them. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await engagementTarget(id))) return postsJson({ error: "Post not found" }, { status: 404 });
  const replies = await repliesFor(id, (await getViewer())?.userId ?? null);
  return postsJson({ replies });
}

/**
 * POST { content } → 201 { reply }: saves the viewer's reply (1–280 chars).
 * The author is derived like a post's (app/api/posts/author.ts); rate
 * limited per author via the post_replies table. Not across a block either
 * way with the post's author (403, lib/blocks.ts).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to reply" }, { status: 401 });

  const body = await readPostsJson(request, 4_096);
  const content = body && body !== "too-large" && typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_POST_CHARS) return postsJson({ error: `Replies are 1–${MAX_POST_CHARS} characters` }, { status: 400 });

  const { id } = await ctx.params;
  try {
    const target = await engagementTarget(id);
    if (!target) return postsJson({ error: "Post not found" }, { status: 404 });
    if (target.authorId && target.authorId !== viewer.userId && (await isBlockedEitherWay(viewer.userId, target.authorId))) {
      return postsJson({ error: "You can't reply to this post." }, { status: 403 });
    }
    const now = Date.now();
    const [lastMinute, lastDay] = await Promise.all([
      replyCountSince(viewer.userId, new Date(now - 60_000)),
      replyCountSince(viewer.userId, new Date(now - 86_400_000)),
    ]);
    if (lastMinute >= PER_MINUTE || lastDay >= PER_DAY) {
      return postsJson({ error: "You're replying too fast. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const reply = await createReply({ postId: id, authorId: viewer.userId, ...(await authorFor(viewer)), content });
    return postsJson({ reply }, { status: 201 });
  } catch (error) {
    // Most likely db/engagement.sql hasn't been applied to this database yet.
    console.error("Saving a reply failed", error);
    return postsJson({ error: "Replying is unavailable right now. Try again soon." }, { status: 503 });
  }
}
