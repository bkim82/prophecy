import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { replyExists, setReplyLike } from "@/lib/engagement";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** POST { liked: boolean } → likes or unlikes one saved reply under the post, as the viewer. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; replyId: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to like replies" }, { status: 401 });

  const body = await readPostsJson(request, 1_024);
  if (!body || body === "too-large" || typeof body.liked !== "boolean") return postsJson({ error: "invalid-like" }, { status: 400 });
  const { id, replyId } = await ctx.params;
  if (!(await replyExists(id, replyId))) return postsJson({ error: "Reply not found" }, { status: 404 });
  await setReplyLike(replyId, viewer.userId, body.liked);
  return postsJson({ ok: true });
}
