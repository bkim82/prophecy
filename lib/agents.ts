import { gateway, generateText, isStepCount, jsonSchema, Output, type JSONSchema7, type LanguageModel } from "ai";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, postReplies, posts, profiles } from "@/db/schema";
import { TOPICS } from "@/app/lib/topics";
import { loadAgentPersonas, type AgentPersona } from "@/lib/agentPersonas";
import { createReply, setLike } from "@/lib/engagement";
import { MAX_POLL_CHOICE_CHARS, MAX_POST_CHARS, POLL_DURATIONS_MS, parsePostInput, type PostInput } from "@/lib/postInput";
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

/**
 * Share of posts drafted after a web search ($5 per 1,000 searches on AI Gateway).
 * 0 while on the free model: a search draft is 2–4 model calls of the run's budget.
 */
export const NEWS_SHARE = 0;

/**
 * Drafts (model calls) per run, made one at a time. The free tier allows 5
 * requests per minute per region; anything due beyond this waits a run.
 */
export const MAX_DRAFTS_PER_RUN = 4;

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

// Rounded the way people say prices (80.4k, 2,343), so drafts don't parrot them to the cent.
const spokenPrice = (price: number) =>
  price >= 10_000 ? `$${(price / 1000).toFixed(1)}k` : price >= 1_000 ? `$${Math.round(price).toLocaleString("en-US")}` : `$${price.toFixed(price >= 10 ? 1 : 2)}`;

async function marketSnapshot(): Promise<string> {
  const prices = await Promise.all(["BTC-USD", "ETH-USD", "HYPE-USD"].map(async (product) => [product, await getSpotPrice(product)] as const));
  const market = prices
    .flatMap(([product, spot]) => (spot ? [`${product.replace("-USD", "")} ${spokenPrice(spot.price)}`] : []))
    .join(", ");
  return market || "unavailable";
}

/** Own posts shown in the post prompt; more than this anchors the model on its own phrasing. */
const OWN_POSTS_SHOWN = 6;

const STOPWORDS = new Set(
  ("a about after all am an and any are as at back be been but by can could did do does don't for from get got had has have he her him his how i i'd i'll "
    + "i'm i've if im in into is isn't it it's its just let's like me more my no not now of off on one only or our out over really she so some still than that "
    + "that's the their them then there they this to too up us very was we were what when where which who why will with would yeah you you're your").split(" "),
);

/**
 * Words and phrases (1–3 words) that show up in at least a quarter of
 * `texts` (and at least 3 of them), most frequent first, minus stopwords and
 * any phrase overlapping one already picked. Fed back to the model as
 * "don't use these", since small models copy their own recent posts. Pure.
 */
export function overusedPhrases(texts: string[], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const words = text.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+|\p{Extended_Pictographic}/gu) ?? [];
    const seen = new Set<string>();
    for (let size = 1; size <= 3; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const gram = words.slice(i, i + size);
        if (gram.every((word) => STOPWORDS.has(word) || /^\d+$/.test(word))) continue;
        if (size === 1 && gram[0].length < 3 && !/\p{Extended_Pictographic}/u.test(gram[0])) continue;
        seen.add(gram.join(" "));
      }
    }
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const floor = Math.max(3, Math.ceil(texts.length / 4));
  const overlaps = (a: string, b: string) => ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
  const picked: string[] = [];
  const ranked = [...counts].filter(([, n]) => n >= floor).sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length);
  for (const [phrase] of ranked) {
    if (picked.length >= limit) break;
    if (!picked.some((other) => overlaps(other, phrase))) picked.push(phrase);
  }
  return picked;
}

/** The persona's newest posts (≤ 20) and replies (≤ 12), newest first. */
async function ownRecent(persona: AgentPersona) {
  const db = getDb();
  const [own, replies] = await Promise.all([
    db.select({ content: posts.content }).from(posts)
      .where(and(isNull(posts.deletedAt), ne(posts.content, ""), eq(posts.authorId, persona.userId)))
      .orderBy(desc(posts.createdAt)).limit(20),
    db.select({ content: postReplies.content }).from(postReplies)
      .where(and(isNull(postReplies.deletedAt), eq(postReplies.authorId, persona.userId)))
      .orderBy(desc(postReplies.createdAt)).limit(12),
  ]);
  return { posts: own.map((row) => row.content), replies: replies.map((row) => row.content) };
}

type AgentContext = { market: string; ownRecent: string[]; avoid: string[]; feed: { author: string; content: string }[] };

async function postContext(persona: AgentPersona, market: string): Promise<AgentContext> {
  const [own, feed] = await Promise.all([
    ownRecent(persona),
    getDb().select({ author: posts.authorName, content: posts.content }).from(posts)
      .where(and(isNull(posts.deletedAt), ne(posts.content, ""), ne(posts.authorId, persona.userId)))
      .orderBy(desc(posts.createdAt)).limit(8),
  ]);
  return { market, ownRecent: own.posts.slice(0, OWN_POSTS_SHOWN), avoid: overusedPhrases([...own.posts, ...own.replies]), feed };
}

const BUILTIN_TOPIC_IDS = TOPICS.map((topic) => topic.id);
const POLL_LENGTHS = Object.keys(POLL_DURATIONS_MS);

/** Follow-up posts after a thread's first one, saved as the author's own replies under it. */
export const MAX_THREAD_FOLLOW_UPS = 3;

type Draft = {
  content: string;
  topics: string[];
  poll?: { choices: string[]; duration: string } | null;
  thread?: string[];
};

type PostShape = { id: string; weight: number; brief: string; poll?: true; thread?: true; needsFeed?: true };

/**
 * What kind of post this draft is, drawn per draft by weight. The model
 * left to itself writes the same one-paragraph post every time; real
 * timelines mix one-liners, rants, lists, shitposts, threads and polls.
 */
export const POST_SHAPES: PostShape[] = [
  { id: "one-liner", weight: 4, brief: "One punchy line, under 70 characters. No setup, no explanation." },
  { id: "take", weight: 4, brief: "A hot take stated as plain fact, one or two sentences. Commit to it, no hedging." },
  { id: "rant", weight: 3, brief: "A rant of 160–250 characters, broken into 3–5 short lines with line breaks. Build up to the point." },
  { id: "list", weight: 2, brief: "A list post: a one-line setup, then 3–5 short lines that each start with \"- \" or a number, one per line." },
  { id: "story", weight: 3, brief: "A tiny story about something that just happened to you: a trade, a conversation, your day. Two to four sentences with one specific detail." },
  { id: "question", weight: 2, brief: "Ask the timeline a real question you want answers to. Short." },
  { id: "reaction", weight: 3, needsFeed: true, brief: "React to ONE post from the feed below the way you'd quote-tweet it: dunk on it, agree way too hard, or riff on it. Don't name or tag its author." },
  { id: "call", weight: 2, brief: "A specific, bold call with a number and a timeframe, and why in a few words." },
  { id: "shitpost", weight: 3, brief: "A shitpost or meme format: \"nobody:\" / \"me:\", \"me in 2021 vs me now\", a fake headline, a fake text exchange, a bit. Line breaks welcome." },
  { id: "confession", weight: 1, brief: "Something honest or embarrassing you'd only admit online. Short." },
  { id: "life", weight: 2, brief: "Something from your life away from the charts (sleep, food, work, family, the gym, your commute), still in your voice. The market is optional." },
  { id: "thread", weight: 2, thread: true, brief: `A thread. The first post is a hook that makes people open it, ending with "🧵" or "1/". Then 2–${MAX_THREAD_FOLLOW_UPS} follow-up posts that build the argument, each a full post of its own, numbered "2/", "3/" and so on.` },
  { id: "poll", weight: 1, poll: true, brief: "Make the timeline pick a side with a poll. The post sets it up; the 2–4 choices are short and pointed or funny." },
];

const pickWeighted = <T extends { weight: number }>(items: T[], random: () => number): T => {
  let roll = random() * items.reduce((sum, item) => sum + item.weight, 0);
  return items.find((item) => (roll -= item.weight) < 0) ?? items[items.length - 1];
};

/** `count` distinct items of `items` in random order. */
const sample = <T,>(items: T[], count: number, random: () => number): T[] => {
  const pool = [...items];
  return Array.from({ length: Math.min(count, pool.length) }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);
};

const pollSchema: JSONSchema7 = {
  type: "object",
  properties: {
    choices: { type: "array", items: { type: "string" }, description: `2–4 choices, each at most ${MAX_POLL_CHOICE_CHARS} characters.` },
    duration: { type: "string", enum: POLL_LENGTHS },
  },
  required: ["choices", "duration"],
  additionalProperties: false,
};

const draftSchema = (shape: PostShape) => jsonSchema<Draft>({
  type: "object",
  properties: {
    content: { type: "string", description: `The post text, at most ${MAX_POST_CHARS} characters.` },
    topics: { type: "array", items: { type: "string", enum: BUILTIN_TOPIC_IDS }, description: "0–3 topics the post is about." },
    ...(shape.poll ? { poll: pollSchema } : {}),
    ...(shape.thread ? { thread: { type: "array", items: { type: "string" }, description: `2–${MAX_THREAD_FOLLOW_UPS} follow-up posts, each at most ${MAX_POST_CHARS} characters.` } } : {}),
  },
  required: ["content", "topics", ...(shape.poll ? ["poll"] : []), ...(shape.thread ? ["thread"] : [])],
  additionalProperties: false,
});

const APP = "You are on Prophecy, a social trading app where people post market calls (\"omens\"), trade memecoins, and play 60-second BTC prediction duels (\"Pulse\").";

const VOICE_RULES = [
  "Sound like a real person typing on their phone, not a brand or an assistant. You have opinions, moods, grudges and running jokes.",
  "No hashtags, no em dashes, no \"Let's dive in\", no calls to action, no disclaimers, no links. Never mention being an AI.",
  "Don't invent news, data releases or statistics as fact. Opinions, predictions and your own (made-up) trades and life are fine.",
  "Most of what you write doesn't mention a price. If you do name a current price it must match the market snapshot, rounded the way people say it (80k, 80.4k, 2.3k), never to the cent. If the snapshot is unavailable, don't name prices.",
];

const STYLE_RULES = [
  APP,
  "Write one post as yourself, in the shape asked for at the end.",
  `Hard limit of ${MAX_POST_CHARS} characters per post. Line breaks are fine.`,
  ...VOICE_RULES,
  "Real timelines are uneven: fragments, run-ons, the odd typo, callbacks to your own running bits. Never open with a ticker and a price.",
  "Don't reuse the ideas, openers or phrases of your recent posts. You may react to a feed post, but don't quote it or tag anyone.",
].join("\n");

const NEWS_PROMPT =
  "Before writing, use web_search once or twice to find something from the last day you'd actually have a take on, "
  + "in your own lane (news, a launch, a hack, a policy move, a big liquidation). React to it like you just read it. "
  + "Name the thing, but don't cite sources or paste headlines.";

// Spelled out because not every model enforces the schema (the free ones don't).
const draftFormat = (shape: PostShape) =>
  `Answer with only a JSON object: {"content": "<the post${shape.thread ? "'s first post" : ""}>", "topics": [<0-3 of ${BUILTIN_TOPIC_IDS.map((id) => `"${id}"`).join(", ")}>]`
  + (shape.poll ? `, "poll": {"choices": ["<2-4 short choices>"], "duration": <one of ${POLL_LENGTHS.map((id) => `"${id}"`).join(", ")}>}` : "")
  + (shape.thread ? `, "thread": ["<follow-up post 2/>", "<follow-up post 3/>"]` : "")
  + "}. Use \\n for line breaks inside the strings.";

/** Your character outranks the shape: a one-liner account still writes its rant its own way. */
const shapeLine = (brief: string) => `This time, write: ${brief} Your character comes first, so do it the way you would.`;

// Sampling temperature: high, since sameness is the failure mode here.
const TEMPERATURE = 1;

/**
 * Per draft. The free model sometimes never answers; without a cap one hung
 * call eats the route's whole maxDuration. MAX_DRAFTS_PER_RUN × this < 300s.
 */
export const DRAFT_TIMEOUT_MS = 60_000;

const REPLY_FORMAT =
  `Answer with only a JSON object: {"thread": <number of the thread you reply in>, "content": "<your reply>", "like": [<thread numbers whose post you like>]}.`;

const localTime = (date: Date, timeZone: string) =>
  date.toLocaleString("en-US", { timeZone, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

type DraftOptions = { model?: LanguageModel; search?: boolean; now?: Date; random?: () => number };

// Gateway-run search (any model): a few short, same-day results keep each search cheap.
const searchTools = () => ({
  web_search: gateway.tools.perplexitySearch({ maxResults: 5, maxTokensPerPage: 512, maxTokens: 4_000, searchRecencyFilter: "day", searchLanguageFilter: ["en"] }),
});

const avoidLine = (avoid: string[]) =>
  avoid.length ? `Words and phrases you've overused lately. Don't use any of them this time: ${avoid.map((phrase) => `"${phrase}"`).join(", ")}.` : "";

export type DraftedPost = PostInput & { thread: string[] };

/**
 * One drafted post for `persona` in `shape` (a POST_SHAPES id; drawn by
 * weight when omitted), or the parse error if the draft breaks the posting
 * rules. A thread's follow-ups come back in `thread`. `search` lets it look
 * up current events first.
 */
export async function draftPost(
  persona: AgentPersona,
  context: AgentContext,
  { model = AGENT_MODEL, search = false, now = new Date(), random = Math.random, shape: shapeId }: DraftOptions & { shape?: string } = {},
): Promise<DraftedPost | { error: string }> {
  const shape = shapeId
    ? POST_SHAPES.find((candidate) => candidate.id === shapeId)
    : pickWeighted(POST_SHAPES.filter((candidate) => !candidate.needsFeed || context.feed.length), random);
  if (!shape) throw new Error(`Unknown post shape "${shapeId}"`);
  const onMind = sample(persona.material, 2, random);
  const { output } = await generateText({
    model,
    system: `${persona.voice}\n\n${STYLE_RULES}`,
    prompt: [
      `Your local time: ${localTime(now, persona.timeZone)}. Market snapshot (background, not something to narrate): ${context.market}.`,
      search ? NEWS_PROMPT : "",
      onMind.length ? `On your mind lately (riff on one in your own words if it fits, or ignore them; don't copy them):\n${onMind.map((item) => `- ${item}`).join("\n")}` : "",
      context.ownRecent.length ? `Your recent posts, newest first:\n${context.ownRecent.map((text) => `- ${text}`).join("\n")}` : "You haven't posted yet.",
      avoidLine(context.avoid),
      context.feed.length ? `Recent posts on the feed:\n${context.feed.map((post) => `- ${post.author}: ${post.content}`).join("\n")}` : "",
      shapeLine(shape.brief),
      draftFormat(shape),
    ].filter(Boolean).join("\n\n"),
    ...(search ? { tools: searchTools(), stopWhen: isStepCount(4) } : {}),
    output: Output.object({ schema: draftSchema(shape) }),
    temperature: TEMPERATURE,
    timeout: DRAFT_TIMEOUT_MS,
    maxRetries: 0,
  });
  // Models without enforced JSON output can drop or invent fields: keep known topics only,
  // and a poll or thread only when that's the shape asked for.
  const topics = Array.isArray(output.topics) ? output.topics.filter((id) => (BUILTIN_TOPIC_IDS as string[]).includes(id)).slice(0, 3) : [];
  const input = parsePostInput({ content: output.content, topics, poll: shape.poll ? output.poll : null });
  if ("error" in input) return input;
  if (!shape.thread) return { ...input, thread: [] };
  const thread = (Array.isArray(output.thread) ? output.thread : []).map((text) => (typeof text === "string" ? text.trim() : "")).filter(Boolean);
  if (!thread.length || thread.length > MAX_THREAD_FOLLOW_UPS) return { error: `A thread has 1–${MAX_THREAD_FOLLOW_UPS} follow-up posts` };
  if (thread.some((text) => text.length > MAX_POST_CHARS)) return { error: `Thread posts are up to ${MAX_POST_CHARS} characters` };
  return { ...input, thread };
}

export type ThreadMessage = { authorId: string; author: string; content: string; createdAt: Date };
export type Thread = { postId: string; post: ThreadMessage; replies: ThreadMessage[] };

/**
 * Threads `persona` could reply in, best first: ones where someone answered
 * it (its post or its reply) since it last spoke, then recent posts by others
 * it hasn't joined. Never a thread whose newest message is its own, one it
 * has replied in MAX_REPLIES_PER_THREAD times (not counting the follow-ups
 * of its own thread post), or one involving an account it's blocked with.
 * `threads` newest post first. Pure.
 */
export function pickThreads(persona: AgentPersona, threads: Thread[], blocked: Set<string>, limit = CANDIDATE_THREADS): Thread[] {
  const owed: Thread[] = [];
  const fresh: Thread[] = [];
  for (const thread of threads) {
    if (blocked.has(thread.post.authorId)) continue;
    const replies = thread.replies.filter((reply) => !blocked.has(reply.authorId));
    const followUps = thread.post.authorId === persona.userId ? replies.findIndex((reply) => reply.authorId !== persona.userId) : 0;
    const mine = replies.slice(followUps < 0 ? replies.length : followUps).filter((reply) => reply.authorId === persona.userId);
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
  "Pick one of the threads below and write one reply in it as yourself, the way you'd reply on X, reacting to the last thing said.",
  "If someone replied to you, answer them and keep the conversation going in your own voice. Pick fights with people you'd disagree with.",
  `Hard limit of ${MAX_POST_CHARS} characters.`,
  ...VOICE_RULES,
  "Don't restate the price unless the argument is about it. Don't tag anyone or start with their name. Don't reuse your own recent phrasing.",
].join("\n");

/** The move a reply makes, drawn per draft by weight, like POST_SHAPES. */
export const REPLY_SHAPES: { id: string; weight: number; brief: string }[] = [
  { id: "short", weight: 4, brief: "Very short: a few words, a one-word verdict, or just an emoji or two." },
  { id: "pushback", weight: 3, brief: "Disagree and say exactly why, in a sentence or two." },
  { id: "joke", weight: 3, brief: "A joke or a roast of what they said." },
  { id: "question", weight: 2, brief: "Ask them something pointed back." },
  { id: "yes-and", weight: 2, brief: "Agree and add the thing they missed, or take it further than they would." },
  { id: "long", weight: 2, brief: "A longer reply of 140–280 characters making your full case, line breaks allowed." },
];

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

/**
 * One drafted reply for `persona` among `threads` (pickThreads), with the
 * posts it likes; or why it can't be used. `avoid` = its overused phrases.
 */
export async function draftReply(
  persona: AgentPersona,
  threads: Thread[],
  market: string,
  { model = AGENT_MODEL, now = new Date(), random = Math.random, avoid = [] }: DraftOptions & { avoid?: string[] } = {},
): Promise<ReplyPlan> {
  const { output } = await generateText({
    model,
    system: `${persona.voice}\n\n${REPLY_RULES}`,
    prompt: [
      `Your local time: ${localTime(now, persona.timeZone)}. Market snapshot (background): ${market}.`,
      threads.map((thread, i) => describeThread(persona, thread, i + 1)).join("\n\n"),
      avoidLine(avoid),
      shapeLine(pickWeighted(REPLY_SHAPES, random).brief),
      REPLY_FORMAT,
    ].filter(Boolean).join("\n\n"),
    output: Output.object({ schema: replySchema }),
    temperature: TEMPERATURE,
    timeout: DRAFT_TIMEOUT_MS,
    maxRetries: 0,
  });
  const target = threads[Number(output.thread) - 1];
  if (!target) return { error: `Picked thread ${output.thread} of ${threads.length}` };
  const content = typeof output.content === "string" ? output.content.trim() : "";
  if (!content || content.length > MAX_POST_CHARS) return { error: `Replies are 1–${MAX_POST_CHARS} characters` };
  const likes = [...new Set(Array.isArray(output.like) ? output.like.map(Number) : [])].flatMap((n) => (threads[n - 1] && threads[n - 1].post.authorId !== persona.userId ? [threads[n - 1].postId] : []));
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
  | { status: "done"; id: string | null; content: string; thread?: string[]; postId?: string; searched?: boolean }
  | { status: "failed"; error: string };

export type AgentRunResult = { handle: string; post: Outcome; reply: Outcome };

const failed = (error: unknown): Outcome => ({ status: "failed", error: error instanceof Error ? error.message : String(error) });

/**
 * One cron tick for every persona file: each decides separately whether to
 * post and whether to reply. `force` makes every persona due for both,
 * ignoring quiet hours and gaps (still capped at MAX_DRAFTS_PER_RUN);
 * `dryRun` drafts without saving.
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
    const { thread, ...draft } = input;
    const done = { status: "done" as const, content: draft.content, ...(thread.length ? { thread } : {}), searched: search };
    if (dryRun) return { ...done, id: null };
    const author = { authorId: persona.userId, authorName: persona.displayName, authorHandle: persona.handle };
    const id = await createPost({ ...draft, ...author, tradeRoiAtPost: null });
    // A thread's follow-ups are the author's own replies, in order, like a thread on X.
    for (const content of thread) await createReply({ postId: id, ...author, content });
    return { ...done, id };
  };

  const reply = async (persona: AgentPersona): Promise<Outcome> => {
    const candidates = pickThreads(persona, threads, blocked.get(persona.userId) ?? new Set());
    if (!candidates.length) return { status: "skipped" };
    const own = await ownRecent(persona);
    const plan = await draftReply(persona, candidates, market, { now, avoid: overusedPhrases([...own.replies, ...own.posts]) });
    if ("error" in plan) return { status: "failed", error: plan.error };
    if (dryRun) return { status: "done", id: null, content: plan.content, postId: plan.postId };
    const saved = await createReply({ postId: plan.postId, authorId: persona.userId, authorName: persona.displayName, authorHandle: persona.handle, content: plan.content });
    await Promise.all(plan.likes.map((postId) => setLike(postId, persona.userId, true)));
    return { status: "done", id: saved.id, content: plan.content, postId: plan.postId };
  };

  const attempt = async (persona: AgentPersona, run: (persona: AgentPersona) => Promise<Outcome>): Promise<Outcome> => {
    try {
      return await run(persona);
    } catch (error) {
      console.error(`agent @${persona.handle} failed`, error);
      return failed(error);
    }
  };

  // One draft at a time, at most MAX_DRAFTS_PER_RUN, in random order so no
  // persona always waits; whatever's left over is still due next run.
  const jobs = [
    ...posting.map((persona) => ({ persona, kind: "post" as const, order: Math.random() })),
    ...replying.map((persona) => ({ persona, kind: "reply" as const, order: Math.random() })),
  ].sort((a, b) => a.order - b.order).slice(0, MAX_DRAFTS_PER_RUN);
  const outcomes = new Map<string, Outcome>();
  for (const { persona, kind } of jobs) {
    outcomes.set(`${kind}:${persona.userId}`, await attempt(persona, kind === "post" ? post : reply));
  }
  const skipped: Outcome = { status: "skipped" };
  const results = personas.map((persona): AgentRunResult => ({
    handle: persona.handle,
    post: outcomes.get(`post:${persona.userId}`) ?? skipped,
    reply: outcomes.get(`reply:${persona.userId}`) ?? skipped,
  }));
  return [...results, ...taken];
}
