import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { engagementTarget, setLike } from "@/lib/engagement";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** POST { liked: boolean } → likes or unlikes a post (saved or mock) as the viewer. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to like posts" }, { status: 401 });

  const body = await readPostsJson(request, 1_024);
  if (!body || body === "too-large" || typeof body.liked !== "boolean") return postsJson({ error: "invalid-like" }, { status: 400 });
  const { id } = await ctx.params;
  if (!(await engagementTarget(id))) return postsJson({ error: "Post not found" }, { status: 404 });
  await setLike(id, viewer.userId, body.liked);
  return postsJson({ ok: true });
}
