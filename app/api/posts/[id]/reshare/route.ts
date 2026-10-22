import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { engagementTarget, isReshareKind, setReshare } from "@/lib/engagement";
import { MAX_POST_CHARS } from "@/lib/postInput";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * POST { kind: "repost" | "vouch" | "defy" | null, text? } → sets the viewer's
 * one repost of a post, with optional words (≤ 280), or with null undoes it.
 * Authors can repost their own post but not vouch for or defy it (403).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to repost" }, { status: 401 });

  const body = await readPostsJson(request, 4_096);
  if (!body || body === "too-large" || (body.kind !== null && !isReshareKind(body.kind))) {
    return postsJson({ error: "invalid-kind" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : body.text === undefined ? "" : null;
  if (text === null || text.length > MAX_POST_CHARS) return postsJson({ error: `Your words are up to ${MAX_POST_CHARS} characters` }, { status: 400 });

  const { id } = await ctx.params;
  const target = await engagementTarget(id);
  if (!target) return postsJson({ error: "Post not found" }, { status: 404 });
  if (body.kind !== null && body.kind !== "repost" && target.authorId === viewer.userId) {
    return postsJson({ error: "You can't vouch for or defy your own omen" }, { status: 403 });
  }
  await setReshare(id, viewer.userId, body.kind === null ? null : { kind: body.kind, text });
  return postsJson({ ok: true });
}
