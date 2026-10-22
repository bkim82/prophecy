"use server";

import { isTopicId, type TopicId } from "@/app/lib/topics";
import { saveTopicPrefs } from "@/lib/topicPrefs";
import { getViewer } from "@/lib/viewer";

// Plenty for a hand-picked list; keeps a forged request from storing junk.
const MAX_TOPICS = 60;

// Unique well-formed TopicIds from an untrusted array, in order.
const topicIds = (value: unknown): TopicId[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is TopicId => typeof id === "string" && isTopicId(id)))].slice(0, MAX_TOPICS) : [];

/**
 * Saves the signed-in account's followed + Not interested topics, both lists
 * whole (useTopicPrefs in app/lib/postLists.ts sends them after every
 * change; server functions run one at a time, so the last one wins). A topic
 * in both is kept as muted. No refresh: the feed already shows the change.
 */
export async function saveTopics(input: { followed: string[]; muted: string[] }): Promise<{ ok: boolean }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false };
  const muted = topicIds(input?.muted);
  const followed = topicIds(input?.followed).filter((id) => !muted.includes(id));
  try {
    await saveTopicPrefs(userId, followed, muted);
    return { ok: true };
  } catch (error) {
    // Most likely db/topics.sql hasn't been applied to this database yet.
    console.error("Saving topics failed", error);
    return { ok: false };
  }
}
