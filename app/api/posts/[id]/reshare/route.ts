import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { isBlockedEitherWay } from "@/lib/blocks";
import { engagementTarget, isReshareKind, setReshare } from "@/lib/engagement";
import { MAX_POST_CHARS } from "@/lib/postInput";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * POST { kind: "repost" | "vouch" | "defy" | null, text? } → sets the viewer's
 * one repost of a post, with optional words (≤ 280), or with null undoes it.
 * Authors can repost their own post but not vouch for or defy it (403); no
 * reposts across a block either way with the author (403, lib/blocks.ts) —
 * undoing one still works.
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
  if (body.kind !== null && target.authorId !== viewer.userId && (await isBlockedEitherWay(viewer.userId, target.authorId))) {
    return postsJson({ error: "You can't repost this post." }, { status: 403 });
  }
  await setReshare(id, viewer.userId, body.kind === null ? null : { kind: body.kind, text });
  return postsJson({ ok: true });
}
