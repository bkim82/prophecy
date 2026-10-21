import { GIFS, type GifId } from "@/app/lib/gifs";
import { MAX_POST_PHOTOS, inspectPostImage } from "@/app/lib/postImage";
import { MAX_POST_TOPICS, isTopicId, type TopicId } from "@/app/lib/topics";
import { isTradeRef } from "@/app/lib/trades";

// What POST /api/posts accepts, checked field by field. Pure (no DB): the
// route still has to confirm the trade is the author's own (lib/trades.ts
// tradeReceiptsFor) and derive the author itself. Mirrors the composer's rules
// (app/compose/Composer.tsx): ≤ 280 chars, ≤ 3 topics, photos / GIF / poll
// are one media slot, a poll needs text or another attachment beside it.

export const MAX_POST_CHARS = 280;
export const MAX_POLL_CHOICE_CHARS = 25;
export const POLL_DURATIONS_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "1d": 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
};

export type PostPhotoInput = { mime: string; base64: string; width: number; height: number };

export type PostInput = {
  content: string;
  topics: TopicId[];
  tradeRef: string | null;
  gif: GifId | null;
  poll: { choices: string[]; durationMs: number } | null;
  photos: PostPhotoInput[];
};

const GIF_IDS = new Set<string>(GIFS.map((gif) => gif.id));
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function parsePostInput(body: Record<string, unknown>): PostInput | { error: string } {
  const content = typeof body.content === "string" ? body.content.trim() : body.content === undefined ? "" : null;
  if (content === null || content.length > MAX_POST_CHARS) return { error: `Posts are up to ${MAX_POST_CHARS} characters` };

  const rawTopics = body.topics ?? [];
  if (!Array.isArray(rawTopics) || rawTopics.length > MAX_POST_TOPICS || !rawTopics.every((id) => typeof id === "string" && isTopicId(id))) {
    return { error: `Up to ${MAX_POST_TOPICS} valid topics` };
  }
  const topics = [...new Set(rawTopics as TopicId[])];

  const tradeRef = body.tradeId ?? null;
  if (tradeRef !== null && !isTradeRef(tradeRef)) return { error: "Unknown trade" };

  const gif = body.gif ?? null;
  if (gif !== null && (typeof gif !== "string" || !GIF_IDS.has(gif))) return { error: "Unknown GIF" };

  let poll: PostInput["poll"] = null;
  if (body.poll !== undefined && body.poll !== null) {
    const raw = body.poll as { choices?: unknown; duration?: unknown };
    const choices = Array.isArray(raw.choices) ? raw.choices.map((choice) => (typeof choice === "string" ? choice.trim() : "")) : [];
    const durationMs = typeof raw.duration === "string" ? POLL_DURATIONS_MS[raw.duration] : undefined;
    if (
      choices.length < 2
      || choices.length > 4
      || choices.some((choice) => choice === "" || choice.length > MAX_POLL_CHOICE_CHARS)
      || durationMs === undefined
    ) {
      return { error: `Polls need 2–4 choices of up to ${MAX_POLL_CHOICE_CHARS} characters and a valid length` };
    }
    poll = { choices, durationMs };
  }

  const rawPhotos = body.photos ?? [];
  if (!Array.isArray(rawPhotos) || rawPhotos.length > MAX_POST_PHOTOS) return { error: `Up to ${MAX_POST_PHOTOS} photos` };
  const photos: PostPhotoInput[] = [];
  for (const raw of rawPhotos as { mime?: unknown; data?: unknown }[]) {
    if (typeof raw?.mime !== "string" || typeof raw.data !== "string" || !BASE64.test(raw.data)) return { error: "Invalid photo" };
    const bytes = Buffer.from(raw.data, "base64");
    try {
      const info = inspectPostImage(bytes, raw.mime);
      photos.push({ mime: info.mime, base64: bytes.toString("base64"), width: info.width, height: info.height });
    } catch {
      return { error: "Photos must be JPEG, PNG, WebP or GIF, up to 1 MB" };
    }
  }

  if ([photos.length > 0, gif !== null, poll !== null].filter(Boolean).length > 1) {
    return { error: "A post can have photos, a GIF or a poll — one of them" };
  }
  if (!content && !tradeRef && photos.length === 0 && !gif) return { error: "Write something or attach a trade" };

  return { content, topics, tradeRef, gif: gif as GifId | null, poll, photos };
}
