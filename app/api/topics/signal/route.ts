import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { isClientTopicSignal } from "@/app/lib/topicInterest";
import { isTopicId } from "@/app/lib/topics";
import { recordTopicSignal, signalCountSince, signalTopicsFor } from "@/lib/topicPrefs";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const PER_MINUTE = 60;

/**
 * POST { signal, postId } or { signal: "view_topic", topic }, plus `on`
 * (default true; false takes a like/bookmark/repost back) → records
 * engagement for inferred interests (app/lib/topicInterest.ts). Topics come
 * from the post on the server, never the body. Sent fire-and-forget by
 * useTopicSignal (app/lib/topicSignals.ts).
 */
export async function POST(request: Request) {
  const failure = postsMutationFailure(request, MAX_BODY_BYTES);
  if (failure) return failure;
  const viewer = await getViewer();
  if (!viewer) return postsJson({ error: "Sign in first" }, { status: 401 });

  const body = await readPostsJson(request, MAX_BODY_BYTES);
  if (body === "too-large") return postsJson({ error: "body-too-large" }, { status: 413 });
  if (!body || typeof body.signal !== "string" || !isClientTopicSignal(body.signal)) return postsJson({ error: "invalid-signal" }, { status: 400 });
  const { signal } = body;
  const on = body.on !== false;

  try {
    if (on && (await signalCountSince(viewer.userId, new Date(Date.now() - 60_000))) >= PER_MINUTE) {
      return postsJson({ error: "too-many-signals" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    if (signal === "view_topic") {
      if (typeof body.topic !== "string" || !isTopicId(body.topic)) return postsJson({ error: "invalid-topic" }, { status: 400 });
      await recordTopicSignal(viewer.userId, signal, [body.topic], "", on);
      return postsJson({ ok: true });
    }
    if (typeof body.postId !== "string" || body.postId.length > 64) return postsJson({ error: "invalid-post" }, { status: 400 });
    const topics = await signalTopicsFor(body.postId, viewer.userId);
    if (!topics) return postsJson({ error: "Post not found" }, { status: 404 });
    await recordTopicSignal(viewer.userId, signal, topics, body.postId, on);
    return postsJson({ ok: true });
  } catch (error) {
    // Most likely db/topics.sql hasn't been applied to this database yet.
    console.error("Recording a topic signal failed", error);
    return postsJson({ error: "unavailable" }, { status: 503 });
  }
}
