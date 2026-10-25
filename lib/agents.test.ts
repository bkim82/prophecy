import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

import type { AgentPersona } from "@/lib/agentPersonas";
import { draftPost, draftReply, isDue, MAX_REPLIES_PER_THREAD, pickThreads, TICK_MINUTES, type Thread } from "@/lib/agents";

const persona: AgentPersona = {
  file: "test.md",
  userId: "user_test",
  displayName: "Test",
  handle: "test_agent",
  bio: "bio",
  location: null,
  voice: "You're a test.",
  postsPer2Hours: [3, 5],
  repliesPer2Hours: [3, 5],
  quietHours: [0, 9 * 60],
  timeZone: "America/New_York",
};
const POSTS = persona.postsPer2Hours;
const MINUTE = 60_000;
// 2026-10-22 is EDT (UTC-4).
const et = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 22, hour + 4, minute));
const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * MINUTE);

// Deterministic Math.random stand-in (mulberry32).
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

describe("isDue", () => {
  it("stays quiet from midnight to 9am in the persona's zone", () => {
    expect(isDue(persona, POSTS, { now: et(3), lastAt: null }, () => 0)).toBe(false);
    expect(isDue(persona, POSTS, { now: et(8, 55), lastAt: null }, () => 0)).toBe(false);
    // 03:00 UTC is 23:00 ET the night before: awake.
    expect(isDue(persona, POSTS, { now: new Date(Date.UTC(2026, 9, 22, 3)), lastAt: null }, () => 0.99)).toBe(true);
  });

  it("never posts sooner than 120/most minutes after the last post", () => {
    expect(isDue(persona, POSTS, { now: et(14), lastAt: minutesBefore(et(14), 20) }, () => 0)).toBe(false);
  });

  it("must post once waiting another tick would break the fewest-per-2h floor", () => {
    // 120/3 = 40, less a tick and a minute of slack.
    expect(isDue(persona, POSTS, { now: et(14), lastAt: minutesBefore(et(14), 34) }, () => 0.999)).toBe(true);
  });

  it("rolls equal odds across the runs left before the deadline", () => {
    // 24 min in, deadline 34: this run and the next two → 1/3.
    const state = { now: et(14), lastAt: minutesBefore(et(14), 24) };
    expect(isDue(persona, POSTS, state, () => 0.33)).toBe(true);
    expect(isDue(persona, POSTS, state, () => 0.34)).toBe(false);
  });

  it("spreads the first post of the day over the minutes after quiet hours end", () => {
    const lastNight = minutesBefore(et(0), 10);
    expect(isDue(persona, POSTS, { now: et(9), lastAt: lastNight }, () => 0.99)).toBe(false);
    expect(isDue(persona, POSTS, { now: et(9, 10), lastAt: lastNight }, () => 0.99)).toBe(true);
  });

  it("handles quiet hours that wrap past midnight, and none at all", () => {
    const night = { ...persona, quietHours: [22 * 60, 6 * 60] as [number, number] };
    expect(isDue(night, POSTS, { now: et(23), lastAt: null }, () => 0)).toBe(false);
    expect(isDue(night, POSTS, { now: et(12), lastAt: null }, () => 0)).toBe(true);
    expect(isDue({ ...persona, quietHours: null }, POSTS, { now: et(3), lastAt: null }, () => 0)).toBe(true);
  });

  it.each([[3, 5], [4, 6], [3, 4], [3, 3]] as [number, number][])(
    "over 3 simulated days at %i-%i: every 2 waking hours has fewest..most posts, none while quiet",
    (fewest, most) => {
      const random = seeded(fewest * 100 + most);
      const posted: number[] = [];
      for (let tick = et(0).getTime(); tick < et(72).getTime(); tick += TICK_MINUTES * MINUTE) {
        // Cron fires up to 30s late; the post lands a few seconds after that.
        const now = new Date(tick + random() * 30_000);
        const lastAt = posted.length ? new Date(posted[posted.length - 1]) : null;
        if (isDue(persona, [fewest, most], { now, lastAt }, random)) posted.push(now.getTime() + 5_000);
      }
      for (const at of posted) {
        const hourEt = new Date(at - 4 * 3_600_000).getUTCHours();
        expect(hourEt).toBeGreaterThanOrEqual(9);
      }
      for (let day = 0; day < 3; day++) {
        for (let start = et(24 * day + 9).getTime(); start <= et(24 * day + 22).getTime(); start += MINUTE) {
          const count = posted.filter((at) => at >= start && at < start + 120 * MINUTE).length;
          expect(count, `window from ${new Date(start).toISOString()}`).toBeGreaterThanOrEqual(fewest);
          expect(count).toBeLessThanOrEqual(most + 1);
        }
      }
    },
  );
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const modelReturning = (draft: object) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(draft) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });

const context = { market: "BTC $100,000", ownRecent: [], feed: [] };

describe("draftPost", () => {
  it("returns post input that passes the composer's rules", async () => {
    const input = await draftPost(persona, context, { model: modelReturning({
      content: "  btc holding 100k again. range traders eating  ",
      topics: ["bitcoin"],
      poll: { choices: ["breakout", "fakeout"], duration: "1d" },
    }) });
    expect(input).toEqual({
      content: "btc holding 100k again. range traders eating",
      topics: ["bitcoin"],
      tradeRef: null,
      gif: null,
      poll: { choices: ["breakout", "fakeout"], durationMs: 86_400_000 },
      photos: [],
    });
  });

  it("reports a draft that breaks the rules instead of posting it", async () => {
    const input = await draftPost(persona, context, { model: modelReturning({ content: "x".repeat(281), topics: [], poll: null }) });
    expect(input).toEqual({ error: "Posts are up to 280 characters" });
  });

  it("spells out the JSON shape and survives a model that drops or invents fields", async () => {
    const model = modelReturning({ content: "chop day", topics: ["bitcoin", "not-a-topic"] });
    expect(await draftPost(persona, context, { model })).toMatchObject({ content: "chop day", topics: ["bitcoin"], poll: null });
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Answer with only a JSON object");
    expect(await draftPost(persona, context, { model: modelReturning({ content: "no topics" }) })).toMatchObject({ content: "no topics", topics: [] });
  });

  it("offers the web search tool and asks for something current only when searching", async () => {
    const model = modelReturning({ content: "etf outflows again, cool", topics: [], poll: null });
    await draftPost(persona, context, { model });
    await draftPost(persona, context, { model, search: true });
    const [plain, searching] = model.doGenerateCalls;
    expect(plain.tools ?? []).toEqual([]);
    expect(searching.tools?.map((tool) => tool.name)).toEqual(["web_search"]);
    expect(JSON.stringify(searching.prompt)).toContain("web_search");
    expect(JSON.stringify(plain.prompt)).not.toContain("web_search");
  });
});

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 16, minutes));
const msg = (authorId: string, content: string, minutes = 0) => ({ authorId, author: authorId, content, createdAt: at(minutes) });
const thread = (postId: string, post: ReturnType<typeof msg>, ...replies: ReturnType<typeof msg>[]): Thread => ({ postId, post, replies });
const ME = persona.userId;

describe("pickThreads", () => {
  it("puts threads where someone answered it first, then posts it hasn't joined", () => {
    const fresh = thread("fresh", msg("bob", "eth to 5k"));
    const answered = thread("answered", msg("carl", "btc dead"), msg(ME, "lol no", 1), msg("carl", "watch", 2));
    const mineAnswered = thread("mine", msg(ME, "range day"), msg("dana", "agreed", 1));
    expect(pickThreads(persona, [fresh, answered, mineAnswered], new Set()).map((t) => t.postId)).toEqual(["answered", "mine", "fresh"]);
  });

  it("skips threads where it spoke last, hit the reply cap, or someone it's blocked with posted", () => {
    const spokeLast = thread("last", msg("bob", "gm"), msg(ME, "gm", 1));
    const ownSilent = thread("own", msg(ME, "anyone up"));
    const capped = thread("capped", msg("bob", "fight me"),
      ...Array.from({ length: MAX_REPLIES_PER_THREAD }, (_, i) => [msg(ME, `no ${i}`, i * 2), msg("bob", `yes ${i}`, i * 2 + 1)]).flat());
    const blockedPost = thread("blocked", msg("troll", "ratio"));
    expect(pickThreads(persona, [spokeLast, ownSilent, capped, blockedPost], new Set(["troll"]))).toEqual([]);
  });

  it("hides blocked accounts' replies, so their message never counts as the last word", () => {
    const withTroll = thread("t", msg("bob", "pump?"), msg(ME, "nah", 1), msg("troll", "cope", 2));
    expect(pickThreads(persona, [withTroll], new Set(["troll"]))).toEqual([]);
    expect(pickThreads(persona, [withTroll], new Set()).map((t) => t.replies.length)).toEqual([2]);
  });
});

describe("draftReply", () => {
  const threads = [thread("p1", msg("bob", "eth to 5k")), thread("p2", msg("carl", "btc dead"), msg(ME, "lol", 1), msg("carl", "watch", 2))];

  it("maps the chosen thread and likes to post ids, dropping bad numbers", async () => {
    const plan = await draftReply(persona, threads, "BTC $100,000", { model: modelReturning({ thread: 2, content: "  watching. still not dead  ", like: [2, 2, 7] }) });
    expect(plan).toEqual({ postId: "p2", content: "watching. still not dead", likes: ["p2"] });
  });

  it("shows the conversation with its own messages marked", async () => {
    const model = modelReturning({ thread: 1, content: "nah", like: [] });
    await draftReply(persona, threads, "BTC $100,000", { model });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Thread 2: post by carl: btc dead");
    expect(prompt).toContain("reply by you: lol");
  });

  it("copes with a reply missing likes or content", async () => {
    expect(await draftReply(persona, threads, "", { model: modelReturning({ thread: "1", content: "same" }) })).toEqual({ postId: "p1", content: "same", likes: [] });
    expect(await draftReply(persona, threads, "", { model: modelReturning({ thread: 1 }) })).toEqual({ error: "Replies are 1–280 characters" });
  });

  it("refuses a thread number that wasn't offered or an over-long reply", async () => {
    expect(await draftReply(persona, threads, "", { model: modelReturning({ thread: 3, content: "hi", like: [] }) })).toEqual({ error: "Picked thread 3 of 2" });
    expect(await draftReply(persona, threads, "", { model: modelReturning({ thread: 1, content: "x".repeat(281), like: [] }) })).toEqual({ error: "Replies are 1–280 characters" });
  });
});
