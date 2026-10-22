import { authorFor } from "@/app/api/posts/author";
import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { MAX_POST_PHOTOS, POST_IMAGE_MAX_BYTES } from "@/app/lib/postImage";
import { parsePostInput, type PostInput } from "@/lib/postInput";
import { createPost, postCountSince } from "@/lib/posts";
import { tradeKey, tradeReceiptsFor } from "@/lib/trades";
import { getViewer, type Viewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Base64 photos (4 × 1 MB → ~5.4 MB) plus the rest of the post.
const MAX_BODY_BYTES = Math.ceil((MAX_POST_PHOTOS * POST_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;
const PER_MINUTE = 5;
const PER_DAY = 200;

/**
 * POST { content, topics, tradeId?, gif?, poll?, photos? } → { id }: saves an
 * omen for the signed-in viewer. The author (name, @handle from `profiles`)
 * is derived here, never read from the body; `tradeId` must be one of the
 * viewer's own trades (tradeReceiptsFor), and an open one's current return is
 * stored as `tradeRoiAtPost`. Rate limited per author via the posts table.
 */
export async function POST(request: Request) {
  const failure = postsMutationFailure(request, MAX_BODY_BYTES);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in to post" }, { status: 401 });

  const body = await readPostsJson(request, MAX_BODY_BYTES);
  if (body === "too-large") return postsJson({ error: "body-too-large" }, { status: 413 });
  if (!body) return postsJson({ error: "invalid-json" }, { status: 400 });
  const input = parsePostInput(body);
  if ("error" in input) return postsJson({ error: input.error }, { status: 400 });

  try {
    return await save(viewer, input);
  } catch (error) {
    // Most likely db/posts.sql hasn't been applied to this database yet.
    console.error("Saving a post failed", error);
    return postsJson({ error: "Posting is unavailable right now. Try again soon." }, { status: 503 });
  }
}

async function save(viewer: Viewer, input: PostInput) {
  const now = Date.now();
  const [lastMinute, lastDay] = await Promise.all([
    postCountSince(viewer.userId, new Date(now - 60_000)),
    postCountSince(viewer.userId, new Date(now - 86_400_000)),
  ]);
  if (lastMinute >= PER_MINUTE || lastDay >= PER_DAY) {
    return postsJson({ error: "You're posting too fast. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let tradeRoiAtPost: number | null = null;
  if (input.tradeRef) {
    const trade = (await tradeReceiptsFor([{ authorId: viewer.userId, ref: input.tradeRef }])).get(tradeKey(viewer.userId, input.tradeRef));
    if (!trade) return postsJson({ error: "That trade isn't one of yours" }, { status: 403 });
    if (trade.open) tradeRoiAtPost = trade.roiPct;
  }

  const id = await createPost({ ...input, ...(await authorFor(viewer)), authorId: viewer.userId, tradeRoiAtPost });
  return postsJson({ id }, { status: 201 });
}
