import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { votePoll } from "@/lib/posts";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const STATUS = { "not-found": 404, closed: 409, "invalid-choice": 400 } as const;

/** POST { choice: number | null } → sets or clears the viewer's vote on a saved post's poll. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const failure = postsMutationFailure(request);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to vote" }, { status: 401 });

  const body = await readPostsJson(request, 2_048);
  if (!body || body === "too-large" || (body.choice !== null && typeof body.choice !== "number")) {
    return postsJson({ error: "invalid-choice" }, { status: 400 });
  }
  const { id } = await ctx.params;
  const result = await votePoll(id, viewer.userId, body.choice as number | null);
  return result === "ok" ? postsJson({ ok: true }) : postsJson({ error: result }, { status: STATUS[result] });
}
