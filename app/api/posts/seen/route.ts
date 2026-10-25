import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { MAX_SEEN_BATCH, recordPostViews } from "@/lib/postViews";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

/**
 * POST { ids } → marks up to 50 saved posts seen by the viewer, so For You
 * leaves them out next time (lib/postViews.ts). Sent in batches by
 * useSeenPostTracker (app/lib/seenPosts.ts); unknown ids are skipped.
 */
export async function POST(request: Request) {
  const failure = postsMutationFailure(request, MAX_BODY_BYTES);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in first" }, { status: 401 });

  const body = await readPostsJson(request, MAX_BODY_BYTES);
  if (body === "too-large") return postsJson({ error: "body-too-large" }, { status: 413 });
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_SEEN_BATCH || !ids.every((id) => typeof id === "string")) {
    return postsJson({ error: "invalid-ids" }, { status: 400 });
  }

  try {
    await recordPostViews(viewer.userId, ids);
    return postsJson({ ok: true });
  } catch (error) {
    // Most likely db/post-views.sql hasn't been applied to this database yet.
    console.error("Recording seen posts failed", error);
    return postsJson({ error: "unavailable" }, { status: 503 });
  }
}
