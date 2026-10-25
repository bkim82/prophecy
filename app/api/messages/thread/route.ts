import { postsJson, postsMutationFailure, readPostsJson } from "@/app/api/posts/responses";
import { MESSAGE_MAX_LENGTH, MESSAGE_MAX_PHOTOS, normalizeMessage } from "@/app/lib/messageRules";
import { POST_IMAGE_MAX_BYTES } from "@/app/lib/postImage";
import { isBlockedEitherWay } from "@/lib/blocks";
import { messageCountSince, saveMessage, sharedPostsFor, threadWith } from "@/lib/messages";
import { parsePhotos } from "@/lib/postInput";
import { handleFor, publicProfileFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
// Base64 photos (4 × 1 MB → ~5.4 MB) plus the text.
const MAX_BODY_BYTES = Math.ceil((MESSAGE_MAX_PHOTOS * POST_IMAGE_MAX_BYTES * 4) / 3) + 16 * 1024;
const PER_MINUTE = 30;
const PER_DAY = 1000;

// "@Sam" / "sam" → the account holding it; null for unknown handles and you.
async function peerAccount(userId: string, handle: unknown) {
  if (typeof handle !== "string") return null;
  const stored = handle.replace(/^@/, "").toLowerCase().slice(0, 40);
  const account = stored ? await publicProfileFor(stored) : null;
  return account && account.userId !== userId ? account : null;
}

/**
 * GET ?handle= → your conversation with that real account
 * (app/lib/messageRules.ts ThreadView). Reading doesn't mark it read — the
 * dock does that with markConversationRead (app/messages/actions.ts). 404 for
 * yourself and unknown handles.
 */
export async function GET(request: Request) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const peer = await peerAccount(userId, new URL(request.url).searchParams.get("handle"));
  if (!peer) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(await threadWith(userId, peer), { headers: NO_STORE });
}

/**
 * POST { handle, body?, photos?, postId? } → 201 { message }: sends a direct
 * message (SendMessageInput) from the Messages dock or a post's Send button.
 * Anyone signed in with a handle of their own (so they can be written back)
 * can message any real account — it lands in their inbox or Requests on read
 * (lib/messages.ts) — unless either has blocked the other. Text is
 * normalized (≤ MESSAGE_MAX_LENGTH), photos are re-checked from their bytes
 * (lib/postInput.ts parsePhotos), and a post must still exist. At least one
 * of the three. Rate limited per sender via the messages table.
 */
export async function POST(request: Request) {
  const failure = postsMutationFailure(request, MAX_BODY_BYTES);
  if (failure) return failure;
  const userId = (await getViewer())?.userId;
  if (!userId) return postsJson({ error: "Sign in to send messages." }, { status: 401 });

  const input = await readPostsJson(request, MAX_BODY_BYTES);
  if (input === "too-large") return postsJson({ error: "Those photos are too large to send." }, { status: 413 });
  if (!input) return postsJson({ error: "invalid-json" }, { status: 400 });

  const body = typeof input.body === "string" ? normalizeMessage(input.body) : input.body === undefined ? "" : null;
  if (body === null || body.length > MESSAGE_MAX_LENGTH) return postsJson({ error: `Messages can be at most ${MESSAGE_MAX_LENGTH} characters.` }, { status: 400 });
  const photos = parsePhotos(input.photos);
  if ("error" in photos) return postsJson({ error: photos.error }, { status: 400 });
  const postId = input.postId ?? null;
  if (postId !== null && (typeof postId !== "string" || postId.length > 64)) return postsJson({ error: "Unknown post." }, { status: 400 });
  if (!body && photos.length === 0 && !postId) return postsJson({ error: "Write a message first." }, { status: 400 });

  const [peer, ownHandle] = await Promise.all([peerAccount(userId, input.handle), handleFor(userId)]);
  if (!peer) return postsJson({ error: "That trader can't receive messages." }, { status: 404 });
  if (!ownHandle) return postsJson({ error: "Choose your @handle on your profile before sending messages." }, { status: 403 });

  const now = Date.now();
  const [blocked, lastMinute, lastDay, shared] = await Promise.all([
    isBlockedEitherWay(userId, peer.userId),
    messageCountSince(userId, new Date(now - 60_000)),
    messageCountSince(userId, new Date(now - 86_400_000)),
    postId ? sharedPostsFor([postId], userId) : null,
  ]);
  if (blocked) return postsJson({ error: `You can't message @${peer.handle}.` }, { status: 403 });
  if (lastMinute >= PER_MINUTE || lastDay >= PER_DAY) {
    return postsJson({ error: "You're sending messages too fast. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (postId && !shared?.has(postId)) return postsJson({ error: "That post isn't available anymore." }, { status: 404 });

  const message = await saveMessage(userId, peer.userId, { body, photos, postId });
  return postsJson({ message }, { status: 201 });
}
