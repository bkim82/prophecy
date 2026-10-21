import { postsJson, postsMutationFailure } from "@/app/api/posts/responses";
import { deletePost } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** DELETE → soft-deletes the viewer's own post; 404 for anyone else's or a missing one. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to delete posts" }, { status: 401 });

  const { id } = await ctx.params;
  const deleted = await deletePost(id, viewer.userId);
  return deleted ? postsJson({ ok: true }) : postsJson({ error: "Post not found" }, { status: 404 });
}
