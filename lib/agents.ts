import { gateway, generateText, isStepCount, jsonSchema, Output, type LanguageModel } from "ai";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, postReplies, posts, profiles } from "@/db/schema";
import { TOPICS } from "@/app/lib/topics";
import { loadAgentPersonas, type AgentPersona } from "@/lib/agentPersonas";
import { createReply, setLike } from "@/lib/engagement";
import { MAX_POLL_CHOICE_CHARS, MAX_POST_CHARS, POLL_DURATIONS_MS, parsePostInput } from "@/lib/postInput";
import { createPost } from "@/lib/posts";
import { getSpotPrice } from "@/lib/spotPrice";

// AI posting accounts: GET /api/cron/agents (Vercel Cron, vercel.ts) calls
// runAgents, which lets each persona (personas/*.md via lib/agentPersonas.ts)
// decide whether to post and whether to reply now. Posts are drafted through
// AI Gateway (sometimes after a web search) and saved with the same input
// rules as POST /api/posts (lib/postInput.ts); replies go under recent posts,
// favouring threads where someone answered the agent, so agents hold
// conversations with each other and with real accounts. Everything is
// written straight through lib/posts.ts / lib/engagement.ts, since an agent
// has no session.

/**
 * AI Gateway model string; auth is the deployment's OIDC token or AI_GATEWAY_API_KEY.
 * A $0 model, since the team's gateway is on the free tier (Haiku 5.5 is refused
 * there). Swap back to "anthropic/claude-haiku-5.5" once credits are bought.
 */
export const AGENT_MODEL = "nvidia/nemotron-3.5-lightning-free";

/** Minutes between cron runs — keep in step with the vercel.ts schedule. */
export const TICK_MINUTES = 5;

/** Share of posts drafted after a web search ($5 per 1,000 searches on AI Gateway). */
export const NEWS_SHARE = 0.5;

/** Posts newer than this are open for replies. */
const THREAD_WINDOW_MS = 6 * 3_600_000;
/** An agent stops replying in a thread after this many of its own replies, so two agents can't loop forever. */
export const MAX_REPLIES_PER_THREAD = 3;
/** Threads offered to the model per reply. */
const CANDIDATE_THREADS = 6;
/** Newest replies shown per thread. */
const THREAD_REPLIES_SHOWN = 6;

export type PostingState = { now: Date; lastAt: Date | null };

const localMinuteOfDay = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return part("hour") * 60 + part("minute");
};

const inWindow = ([start, end]: [number, number], minute: number) =>
  start <= end ? minute >= start && minute < end : minute >= start || minute < end;

/**
 * Whether `persona` acts (posts or replies) on this run, at `perTwoHours`
 * [fewest, most]. Never in quiet hours; otherwise each gap since its last
 * one lands at random between 120/most minutes and the last run that keeps
 * it under 120/fewest, so any 2 waking hours hold at least `fewest`. The
 * first one after quiet hours lands within that same spread of them ending.
 * Pure apart from `random`.
 */
export function isDue(persona: AgentPersona, perTwoHours: [number, number], state: PostingState, random = Math.random): boolean {
  const minute = localMinuteOfDay(state.now, persona.timeZone);
  const quiet = persona.quietHours;
  if (quiet && inWindow(quiet, minute)) return false;
  const [fewest, most] = perTwoHours;
  // Latest gap that still stays under 120/fewest if this run is skipped,
  // with a minute's slack for cron jitter and drafting time.
  const deadline = 120 / fewest - TICK_MINUTES - 1;
  const shortest = Math.min(120 / most, deadline);
  const sinceLast = state.lastAt ? (state.now.getTime() - state.lastAt.getTime()) / 60_000 : Infinity;
  const sinceWake = quiet ? (minute - quiet[1] + 24 * 60) % (24 * 60) : Infinity;
  const elapsed = Math.min(sinceLast, sinceWake + shortest);
  if (elapsed < shortest) return false;
  if (elapsed >= deadline) return true;
  // Equal odds for every remaining run up to the deadline.
  return random() < TICK_MINUTES / (deadline - elapsed + TICK_MINUTES);
}

/**
 * Upserts each persona's `profiles` row from its file (name, handle, bio,
 * location; `updated_at` untouched, since it doubles as the profile's join
 * date). Returns the personas that own their row — a handle already taken by
 * a real account leaves that persona out rather than posting under someone
 * else's handle.
 */
export async function ensureAgentProfiles(personas: AgentPersona[]): Promise<AgentPersona[]> {
  if (!personas.length) return [];
  const db = getDb();
  const holders = await db
    .select({ userId: profiles.userId, handle: profiles.handle })
    .from(profiles)
    .where(inArray(profiles.handle, personas.map((persona) => persona.handle)));
  const free = personas.filter((persona) => holders.every((row) => row.handle !== persona.handle || row.userId === persona.userId));
  if (!free.length) return [];
  const excluded = (column: { name: string }) => sql.raw(`excluded.${column.name}`);
  await db
    .insert(profiles)
    .values(free.map(({ userId, displayName, handle, bio, location }) => ({ userId, displayName, handle, bio, location })))
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        displayName: excluded(profiles.displayName),
        handle: excluded(profiles.handle),
        bio: excluded(profiles.bio),
        location: excluded(profiles.location),
      },
    });
  return free;
}

async function marketSnapshot(): Promise<string> {
  const prices = await Promise.all(["BTC-USD", "ETH-USD", "HYPE-USD"].map(async (product) => [product, await getSpotPrice(product)] as const));
  const market = prices
    .flatMap(([product, spot]) => (spot ? [`${product.replace("-USD", "")} $${spot.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`] : []))
    .join(", ");
  return market || "unavailable";
}

type AgentContext = { market: string; ownRecent: string[]; feed: { author: string; content: string }[] };

async function postContext(persona: AgentPersona, market: string): Promise<AgentContext> {
  const db = getDb();
  const live = and(isNull(posts.deletedAt), ne(posts.content, ""));
  const [own, feed] = await Promise.all([
    db.select({ content: posts.content }).from(posts)
      .where(and(live, eq(posts.authorId, persona.userId)))
      .orderBy(desc(posts.createdAt)).limit(20),
    db.select({ author: posts.authorName, content: posts.content }).from(posts)
      .where(and(live, ne(posts.authorId, persona.userId)))
      .orderBy(desc(posts.createdAt)).limit(8),
  ]);
  return { market, ownRecent: own.map((row) => row.content), feed };
}

const BUILTIN_TOPIC_IDS = TOPICS.map((topic) => topic.id);
const POLL_LENGTHS = Object.keys(POLL_DURATIONS_MS);

type Draft = {
  content: string;
  topics: string[];
  poll: { choices: string[]; duration: string } | null;
};

const draftSchema = jsonSchema<Draft>({
  type: "object",
  properties: {
    content: { type: "string", description: `The post text, at most ${MAX_POST_CHARS} characters.` },
    topics: { type: "array", items: { type: "string", enum: BUILTIN_TOPIC_IDS }, description: "0–3 topics the post is about." },
    poll: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            choices: { type: "array", items: { type: "string" }, description: `2–4 choices, each at most ${MAX_POLL_CHOICE_CHARS} characters.` },
            duration: { type: "string", enum: POLL_LENGTHS },
          },
          required: ["choices", "duration"],
          additionalProperties: false,
        },
      ],
      description: "Usually null. Only when the post asks the timeline to pick a side.",
    },
  },
  required: ["content", "topics", "poll"],
  additionalProperties: false,
});

const APP = "You are on Prophecy, a social trading app where people post market calls (\"omens\"), trade memecoins, and play 60-second BTC prediction duels (\"Pulse\").";

const VOICE_RULES = [
  "Sound like a real person typing on their phone, not a brand or an assistant.",
  "No hashtags, no em dashes, no \"Let's dive in\", no calls to action, no disclaimers, no links. Never mention being an AI.",
  "Only use prices from the market snapshot; if it's unavailable, don't name prices.",
];

const STYLE_RULES = [
  APP,
  "Write exactly one post as yourself.",
  `Keep it under ${MAX_POST_CHARS} characters; most posts are well under 140.`,
  ...VOICE_RULES,
  "Don't repeat the ideas or phrasing of your recent posts. You may react to a feed post, but don't quote it or tag anyone.",
].join("\n");

const NEWS_PROMPT =
  "Before writing, use web_search once or twice to find something from the last day you'd actually have a take on, "
  + "in your own lane (news, a launch, a hack, a policy move, a big liquidation). React to it like you just read it. "
  + "Name the thing, but don't cite sources or paste headlines.";

const localTime = (date: Date, timeZone: string) =>
  date.toLocaleString("en-US", { timeZone, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

type DraftOptions = { model?: LanguageModel; search?: boolean; now?: Date };

// Gateway-run search (any model): a few short, same-day results keep each search cheap.
const searchTools = () => ({
  web_search: gateway.tools.perplexitySearch({ maxResults: 5, maxTokensPerPage: 512, maxTokens: 4_000, searchRecencyFilter: "day", searchLanguageFilter: ["en"] }),
});

/**
 * One drafted post for `persona`, or the parse error if the draft breaks the
 * posting rules. `search` lets it look up current events first.
 */
export async function draftPost(persona: AgentPersona, context: AgentContext, { model = AGENT_MODEL, search = false, now = new Date() }: DraftOptions = {}) {
  const { output } = await generateText({
    model,
    system: `${persona.voice}\n\n${STYLE_RULES}`,
    prompt: [
      `Your local time: ${localTime(now, persona.timeZone)}. Market snapshot: ${context.market}.`,
      search ? NEWS_PROMPT : "",
      context.ownRecent.length ? `Your recent posts, newest first:\n${context.ownRecent.map((text) => `- ${text}`).join("\n")}` : "You haven't posted yet.",
      context.feed.length ? `Recent posts on the feed:\n${context.feed.map((post) => `- ${post.author}: ${post.content}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    ...(search ? { tools: searchTools(), stopWhen: isStepCount(4) } : {}),
    output: Output.object({ schema: draftSchema }),
  });
  return parsePostInput({ content: output.content, topics: output.topics.slice(0, 3), poll: output.poll });
}

export type ThreadMessage = { authorId: string; author: string; content: string; createdAt: Date };
export type Thread = { postId: string; post: ThreadMessage; replies: ThreadMessage[] };

/**
 * Threads `persona` could reply in, best first: ones where someone answered
 * it (its post or its reply) since it last spoke, then recent posts by others
 * it hasn't joined. Never a thread whose newest message is its own, one it
 * has replied in MAX_REPLIES_PER_THREAD times, or one involving an account
 * it's blocked with. `threads` newest post first. Pure.
 */
export function pickThreads(persona: AgentPersona, threads: Thread[], blocked: Set<string>, limit = CANDIDATE_THREADS): Thread[] {
  const owed: Thread[] = [];
  const fresh: Thread[] = [];
  for (const thread of threads) {
    if (blocked.has(thread.post.authorId)) continue;
    const replies = thread.replies.filter((reply) => !blocked.has(reply.authorId));
    const mine = replies.filter((reply) => reply.authorId === persona.userId);
    if (mine.length >= MAX_REPLIES_PER_THREAD) continue;
    const newest = replies.at(-1) ?? thread.post;
    if (newest.authorId === persona.userId) continue;
    const joined = thread.post.authorId === persona.userId || mine.length > 0;
    (joined ? owed : fresh).push({ ...thread, replies });
  }
  return [...owed, ...fresh].slice(0, limit);
}

type ReplyDraft = { thread: number; content: string; like: number[] };

const replySchema = jsonSchema<ReplyDraft>({
  type: "object",
  properties: {
    thread: { type: "integer", description: "The number of the thread you're replying in." },
    content: { type: "string", description: `Your reply, 1–${MAX_POST_CHARS} characters.` },
    like: { type: "array", items: { type: "integer" }, description: "Numbers of threads whose post you'd like (heart). Often just the one you reply to, sometimes none." },
  },
  required: ["thread", "content", "like"],
  additionalProperties: false,
});

const REPLY_RULES = [
  APP,
  "Pick one of the threads below and write one reply in it as yourself, the way you'd reply on X: short, reacting to the last thing said.",
  "If someone replied to you, answer them: agree, push back, joke, ask something back. Keep the conversation going in your own voice.",
  `Keep it under ${MAX_POST_CHARS} characters; most replies are under 100.`,
  ...VOICE_RULES,
  "Don't tag anyone or start with their name.",
].join("\n");

const describeThread = (persona: AgentPersona, thread: Thread, n: number) => {
  const who = (message: ThreadMessage) => (message.authorId === persona.userId ? "you" : message.author);
  const shown = thread.replies.slice(-THREAD_REPLIES_SHOWN);
  const lines = [
    `Thread ${n}: post by ${who(thread.post)}: ${thread.post.content}`,
    ...(thread.replies.length > shown.length ? [`  (${thread.replies.length - shown.length} earlier replies)`] : []),
    ...shown.map((reply) => `  reply by ${who(reply)}: ${reply.content}`),
  ];
  return lines.join("\n");
};

export type ReplyPlan = { postId: string; content: string; likes: string[] } | { error: string };

/** One drafted reply for `persona` among `threads` (pickThreads), with the posts it likes; or why it can't be used. */
export async function draftReply(persona: AgentPersona, threads: Thread[], market: string, { model = AGENT_MODEL, now = new Date() }: DraftOptions = {}): Promise<ReplyPlan> {
  const { output } = await generateText({
    model,
    system: `${persona.voice}\n\n${REPLY_RULES}`,
    prompt: [
      `Your local time: ${localTime(now, persona.timeZone)}. Market snapshot: ${market}.`,
      threads.map((thread, i) => describeThread(persona, thread, i + 1)).join("\n\n"),
    ].join("\n\n"),
    output: Output.object({ schema: replySchema }),
  });
  const target = threads[output.thread - 1];
  if (!target) return { error: `Picked thread ${output.thread} of ${threads.length}` };
  const content = output.content.trim();
  if (!content || content.length > MAX_POST_CHARS) return { error: `Replies are 1–${MAX_POST_CHARS} characters` };
  const likes = [...new Set(output.like)].flatMap((n) => (threads[n - 1] && threads[n - 1].post.authorId !== persona.userId ? [threads[n - 1].postId] : []));
  return { postId: target.postId, content, likes };
}

/** Live posts from the last THREAD_WINDOW_MS with their live replies (oldest first), newest post first. */
async function openThreads(now: Date): Promise<Thread[]> {
  const db = getDb();
  const recent = await db
    .select({ id: posts.id, authorId: posts.authorId, author: posts.authorName, content: posts.content, createdAt: posts.createdAt })
    .from(posts)
    .where(and(isNull(posts.deletedAt), ne(posts.content, ""), gte(posts.createdAt, new Date(now.getTime() - THREAD_WINDOW_MS))))
    .orderBy(desc(posts.createdAt))
    .limit(40);
  if (!recent.length) return [];
  const replies = await db
    .select({ postId: postReplies.postId, authorId: postReplies.authorId, author: postReplies.authorName, content: postReplies.content, createdAt: postReplies.createdAt })
    .from(postReplies)
    .where(and(inArray(postReplies.postId, recent.map((post) => post.id)), isNull(postReplies.deletedAt)))
    .orderBy(asc(postReplies.createdAt));
  return recent.map(({ id, ...post }) => ({ postId: id, post, replies: replies.filter((reply) => reply.postId === id) }));
}

/** Per persona, everyone it has blocked or who blocked it (lib/blocks.ts semantics). */
async function blockedByPersona(personas: AgentPersona[]): Promise<Map<string, Set<string>>> {
  const ids = personas.map((persona) => persona.userId);
  const rows = await getDb()
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)));
  return new Map(personas.map((persona) => [
    persona.userId,
    new Set(rows.flatMap((row) => (row.blockerId === persona.userId ? [row.blockedId] : row.blockedId === persona.userId ? [row.blockerId] : []))),
  ]));
}

type Outcome =
  | { status: "skipped" }
  | { status: "done"; id: string | null; content: string; postId?: string; searched?: boolean }
  | { status: "failed"; error: string };

export type AgentRunResult = { handle: string; post: Outcome; reply: Outcome };

const failed = (error: unknown): Outcome => ({ status: "failed", error: error instanceof Error ? error.message : String(error) });

/**
 * One cron tick for every persona file: each decides separately whether to
 * post and whether to reply. `force` makes every persona do both now,
 * ignoring quiet hours and gaps; `dryRun` drafts without saving.
 */
export async function runAgents({ force = false, dryRun = false } = {}): Promise<AgentRunResult[]> {
  const all = loadAgentPersonas();
  const personas = await ensureAgentProfiles(all);
  const taken = all.filter((persona) => !personas.includes(persona))
    .map((persona): AgentRunResult => ({ handle: persona.handle, post: failed("Handle is taken by another account"), reply: { status: "skipped" } }));
  if (!personas.length) return taken;

  const now = new Date();
  const db = getDb();
  const ids = personas.map((persona) => persona.userId);
  const [lastPosts, lastReplies] = await Promise.all([
    db.select({ authorId: posts.authorId, at: sql<Date>`max(${posts.createdAt})`.mapWith(posts.createdAt) }).from(posts)
      .where(and(inArray(posts.authorId, ids), isNull(posts.deletedAt))).groupBy(posts.authorId),
    db.select({ authorId: postReplies.authorId, at: sql<Date>`max(${postReplies.createdAt})`.mapWith(postReplies.createdAt) }).from(postReplies)
      .where(and(inArray(postReplies.authorId, ids), isNull(postReplies.deletedAt))).groupBy(postReplies.authorId),
  ]);
  const lastAt = (rows: { authorId: string; at: Date }[], persona: AgentPersona) => rows.find((row) => row.authorId === persona.userId)?.at ?? null;

  const posting = personas.filter((persona) => force || isDue(persona, persona.postsPer2Hours, { now, lastAt: lastAt(lastPosts, persona) }));
  const replying = personas.filter((persona) =>
    persona.repliesPer2Hours && (force || isDue(persona, persona.repliesPer2Hours, { now, lastAt: lastAt(lastReplies, persona) })));
  if (!posting.length && !replying.length) {
    return [...personas.map((persona): AgentRunResult => ({ handle: persona.handle, post: { status: "skipped" }, reply: { status: "skipped" } })), ...taken];
  }

  const [market, threads, blocked] = await Promise.all([
    marketSnapshot(),
    replying.length ? openThreads(now) : Promise.resolve([]),
    replying.length ? blockedByPersona(replying) : Promise.resolve(new Map<string, Set<string>>()),
  ]);

  const post = async (persona: AgentPersona): Promise<Outcome> => {
    const context = await postContext(persona, market);
    const search = Math.random() < NEWS_SHARE;
    // A failed search step falls back to a plain draft rather than skipping the slot.
    const input = await draftPost(persona, context, { search, now }).catch((error) => {
      if (!search) throw error;
      console.error(`agent @${persona.handle} search draft failed, retrying without search`, error);
      return draftPost(persona, context, { now });
    });
    if ("error" in input) return { status: "failed", error: input.error };
    if (dryRun) return { status: "done", id: null, content: input.content, searched: search };
    const id = await createPost({ ...input, authorId: persona.userId, authorName: persona.displayName, authorHandle: persona.handle, tradeRoiAtPost: null });
    return { status: "done", id, content: input.content, searched: search };
  };

  const reply = async (persona: AgentPersona): Promise<Outcome> => {
    const candidates = pickThreads(persona, threads, blocked.get(persona.userId) ?? new Set());
    if (!candidates.length) return { status: "skipped" };
    const plan = await draftReply(persona, candidates, market, { now });
    if ("error" in plan) return { status: "failed", error: plan.error };
    if (dryRun) return { status: "done", id: null, content: plan.content, postId: plan.postId };
    const saved = await createReply({ postId: plan.postId, authorId: persona.userId, authorName: persona.displayName, authorHandle: persona.handle, content: plan.content });
    await Promise.all(plan.likes.map((postId) => setLike(postId, persona.userId, true)));
    return { status: "done", id: saved.id, content: plan.content, postId: plan.postId };
  };

  const attempt = async (due: boolean, persona: AgentPersona, run: (persona: AgentPersona) => Promise<Outcome>): Promise<Outcome> => {
    if (!due) return { status: "skipped" };
    try {
      return await run(persona);
    } catch (error) {
      console.error(`agent @${persona.handle} failed`, error);
      return failed(error);
    }
  };

  const results = await Promise.all(personas.map(async (persona): Promise<AgentRunResult> => {
    const [postOutcome, replyOutcome] = await Promise.all([
      attempt(posting.includes(persona), persona, post),
      attempt(replying.includes(persona), persona, reply),
    ]);
    return { handle: persona.handle, post: postOutcome, reply: replyOutcome };
  }));
  return [...results, ...taken];
}
