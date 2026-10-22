import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { deleteReply, editReply } from "@/lib/engagement";
import { MAX_POST_CHARS } from "@/lib/postInput";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; replyId: string }> };

/** PATCH { content } → { content }: rewrites the viewer's own reply (1–280 chars) and marks it edited; 404 for anyone else's. */
export async function PATCH(request: Request, ctx: Ctx) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to edit replies" }, { status: 401 });

  const body = await readPostsJson(request, 4_096);
  const content = body && body !== "too-large" && typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > MAX_POST_CHARS) return postsJson({ error: `Replies are 1–${MAX_POST_CHARS} characters` }, { status: 400 });
  const { id, replyId } = await ctx.params;
  const edited = await editReply(id, replyId, viewer.userId, content);
  return edited ? postsJson({ content }) : postsJson({ error: "Reply not found" }, { status: 404 });
}

/** DELETE → soft-deletes the viewer's own reply; 404 for anyone else's or a missing one. */
export async function DELETE(request: Request, ctx: Ctx) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to delete replies" }, { status: 401 });

  const { id, replyId } = await ctx.params;
  const deleted = await deleteReply(id, replyId, viewer.userId);
  return deleted ? postsJson({ ok: true }) : postsJson({ error: "Reply not found" }, { status: 404 });
}
