import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { voteClash } from "@/lib/engagement";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** POST { side: 0 | 1 | null } → sides with one of a clash's two calls, or with null takes the vote back. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to vote" }, { status: 401 });

  const body = await readPostsJson(request, 1_024);
  if (!body || body === "too-large" || (body.side !== 0 && body.side !== 1 && body.side !== null)) {
    return postsJson({ error: "invalid-side" }, { status: 400 });
  }
  const { id } = await ctx.params;
  const voted = await voteClash(id, viewer.userId, body.side);
  return voted ? postsJson({ ok: true }) : postsJson({ error: "Clash not found" }, { status: 404 });
}
