import { describe, expect, it } from "vitest";
import { HALF_LIFE_DAYS, inferInterests, MAX_INFERRED, type SignalEvent, type TopicSignal } from "@/app/lib/topicInterest";

const NOW = Date.UTC(2026, 9, 21);
const DAY = 86_400_000;
const none = { followed: [], muted: [], now: NOW };

const on = (topic: string, signal: TopicSignal, postId: string, daysAgo = 0): SignalEvent => ({ topic, signal, postId, at: NOW - daysAgo * DAY });
const visits = (topic: string, count: number): SignalEvent[] =>
  Array.from({ length: count }, (_, i) => ({ topic, signal: "view_topic", postId: "", at: NOW - i * 3_600_000 }));

describe("inferInterests", () => {
  it("infers a topic from three liked posts", () => {
    expect(inferInterests([on("solana", "like", "a"), on("solana", "like", "b"), on("solana", "like", "c")], none)).toEqual(["solana"]);
  });

  it("needs more than two likes", () => {
    expect(inferInterests([on("solana", "like", "a"), on("solana", "like", "b")], none)).toEqual([]);
  });

  it("infers from repeated topic visits alone", () => {
    expect(inferInterests(visits("ai", 6), none)).toEqual(["ai"]);
    expect(inferInterests(visits("ai", 4), none)).toEqual([]);
  });

  it("won't infer from one post, however engaged", () => {
    const onePost = [on("saylor", "like", "a"), on("saylor", "bookmark", "a"), on("saylor", "reply", "a"), on("saylor", "repost", "a")];
    expect(inferInterests(onePost, none)).toEqual([]);
    expect(inferInterests([...onePost, on("saylor", "open_post", "b")], none)).toEqual(["saylor"]);
  });

  it("lets old signals fade", () => {
    const likes = (daysAgo: number) => ["a", "b", "c"].map((id) => on("pepe", "like", id, daysAgo));
    expect(inferInterests(likes(1), none)).toEqual(["pepe"]);
    expect(inferInterests(likes(HALF_LIFE_DAYS), none)).toEqual([]);
    expect(inferInterests(likes(90), none)).toEqual([]);
  });

  it("skips followed and Not interested topics", () => {
    const events = [...visits("ai", 8), ...visits("defi", 8), ...visits("macro", 8)];
    expect(inferInterests(events, { followed: ["ai"], muted: ["defi"], now: NOW })).toEqual(["macro"]);
  });

  it("ranks by score, capped", () => {
    const topics = ["ai", "defi", "macro", "nvidia", "elon", "bonk"];
    const events = topics.flatMap((topic, i) => visits(topic, 6 + i));
    expect(inferInterests(events, none)).toEqual(["bonk", "elon", "nvidia", "macro"].slice(0, MAX_INFERRED));
  });

  it("ignores unknown topics", () => {
    expect(inferInterests(visits("not a topic!", 10), none)).toEqual([]);
  });
});
