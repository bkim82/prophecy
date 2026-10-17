import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bots, matches } from "@/db/schema";
import { pulsePositionsUnchanged, type MatchRow } from "@/lib/match";
import {
  PULSE_WAGER_OPTIONS,
  pulseAvailableCash,
  pulsePositionPnl,
  type PulsePosition,
} from "@/lib/pulse";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";

// House players that keep every matched Pulse slot populated. A bot is a
// `bots` row (persona) plus `matches.bot_state` (its brain for one round);
// nothing client-facing says "bot" — views, names and ids look like any player.

/**
 * Every lobby timer on these markets gets a bot waiting (app/duel/page.tsx
 * TIMER_PRESETS). BTC only: other markets stay human-only, so a shared invite
 * there isn't taken by a bot first.
 */
const BOT_MARKETS: readonly string[] = ["btc"];
const BOT_TIMERS = [60, 120, 300] as const;
/** Every lobby wager gets its own bot host, since matchmaking pairs on the exact wager. */
const BOT_WAGERS = PULSE_WAGER_OPTIONS;

/** Personas are minted until the pool reaches this size, then reused at random. */
const POOL_TARGET = 80;
/** A bot host's listed wait cycles through this, so a long-lived row never reads "waiting 40m". */
const HOSTED_AGE_CYCLE_MS = 90_000;
/** A human queued alone gets a bot after a human-feeling wait in this range. */
const JOIN_DELAY_MS = [3_000, 9_000] as const;
/** `ensureBotSlots` runs off the lobby poll; this spaces it out per server instance. */
const ENSURE_EVERY_MS = 4_000;

export type BotState = {
  role: 1 | 2;
  /** 0 = reckless, 1 = disciplined. Copied from the persona at seat time. */
  skill: number;
  /** Reaction time before the first trade, counted from `roundStartAt`. */
  firstDelayMs: number;
  /** 0 until the bot has acted once. */
  nextActAt: number;
  lastPrice: number | null;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const lerp = (bad: number, good: number, skill: number) => bad + (good - bad) * skill;

// ---------------------------------------------------------------- names

const FIRST = [
  "Mateo", "Priya", "Jonah", "Aiko", "Lena", "Marcus", "Sofia", "Kwame", "Noor", "Elias",
  "Camila", "Dmitri", "Hana", "Theo", "Zara", "Luca", "Imani", "Ravi", "Freya", "Diego",
  "Mina", "Owen", "Yusuf", "Clara", "Kenji", "Amara", "Felix", "Leila", "Jasper", "Nadia",
  "Tomas", "Ines", "Kai", "Maya", "Bruno", "Esme", "Arjun", "Wren", "Sami", "Lucía",
  "Ezra", "Talia", "Nico", "Ada", "Rhys", "Juno", "Malik", "Ivy", "Soren", "Yara",
];
const ADJ = [
  "quiet", "lunar", "salty", "rapid", "cosmic", "lazy", "neon", "frosty", "sly", "golden",
  "rusty", "mellow", "wild", "dusty", "bold", "sleepy", "crispy", "midnight", "lucky", "static",
];
const NOUN = [
  "falcon", "otter", "panda", "fox", "wolf", "candle", "whale", "moth", "raven", "tiger",
  "comet", "pixel", "badger", "lynx", "heron", "koi", "goose", "yak", "gecko", "sloth",
];
const CRYPTO = ["sats", "wick", "pump", "hodl", "gwei", "chart", "long", "short", "degen", "ape"];
const SUFFIX = ["trades", "fx", "eth", "btc", "xyz", "irl", "cap", "lol"];

const digits = () => String(Math.floor(rand(1, 999)));

/** A handle or first name in the same shapes `lib/opponentNames.ts` renders for real players. */
export function randomBotName(): string {
  const first = pick(FIRST);
  const lower = first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shapes: (() => string)[] = [
    () => first,
    () => first,
    () => `@${pick(ADJ)}${pick(NOUN)}`,
    () => `@${pick(ADJ)}_${pick(NOUN)}${digits()}`,
    () => `@${lower}${pick([".", "_", ""])}${pick(SUFFIX)}`,
    () => `@${lower}${lower[0] === "a" ? "x" : pick(["k", "j", "m", "z"])}${Math.random() < 0.5 ? digits() : ""}`,
    () => `@${pick(CRYPTO)}${pick(["", "_"])}${pick(NOUN)}`,
    () => `@0x${lower}`,
    () => `@${lower}_${pick(CRYPTO)}`,
  ];
  return pick(shapes)();
}

/** Clerk-shaped id (`user_` + 27 base62), so a bot's id leaks nothing if it reaches a client. */
function randomUserId() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "user_";
  for (let i = 0; i < 27; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

/** `count` distinct personas, minting new ones while the pool is under target. */
async function pickPersonas(count: number) {
  const db = getDb();
  const [{ size }] = await db.select({ size: sql<number>`count(*)::int` }).from(bots);
  const existing = await db
    .select()
    .from(bots)
    .orderBy(sql`random()`)
    .limit(count);
  const minted = Array.from({ length: count }, () => ({
    id: randomUserId(),
    name: randomBotName(),
    skill: Math.random(),
  }));
  const chosen = minted.map((fresh, i) =>
    existing[i] && Math.random() < size / POOL_TARGET ? existing[i] : fresh,
  );
  const toInsert = chosen.filter((persona) => minted.includes(persona));
  if (toInsert.length > 0) await db.insert(bots).values(toInsert).onConflictDoNothing();
  return chosen;
}

/** Bot ids → display names, for `lib/opponentNames.ts`. */
export async function botNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: bots.id, name: bots.name })
    .from(bots)
    .where(inArray(bots.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

const freshState = (role: 1 | 2, skill: number): BotState => ({
  role,
  skill,
  firstDelayMs: Math.round(lerp(rand(800, 4_000), rand(1_500, 7_000), skill)),
  nextActAt: 0,
  lastPrice: null,
});

// ---------------------------------------------------------------- lobby presence

let lastEnsure = 0;

/**
 * Keeps one bot-hosted `open` match per (market, timer, wager) slot. Lazy, like the
 * rest of matchmaking: the lobby poll calls it, and a slot only gets a new
 * persona once its bot has been joined (the row leaves `open`). A partial unique index
 * (`matches_one_open_bot_per_slot`) makes concurrent callers harmless.
 */
export async function ensureBotSlots() {
  if (Date.now() - lastEnsure < ENSURE_EVERY_MS) return;
  lastEnsure = Date.now();
  const db = getDb();
  const hosted = and(eq(matches.status, "open"), isNotNull(matches.botState));

  const live = await db
    .select({ market: matches.market, timerSeconds: matches.timerSeconds, wager: matches.wager })
    .from(matches)
    .where(hosted);

  const missing = BOT_MARKETS.flatMap((market) =>
    BOT_TIMERS.flatMap((timerSeconds) =>
      BOT_WAGERS.filter((wager) => !live.some((row) =>
        row.market === market && row.timerSeconds === timerSeconds && row.wager === wager,
      )).map((wager) => ({ market, timerSeconds, wager })),
    ),
  );
  if (missing.length === 0) return;

  const personas = await pickPersonas(missing.length);
  await db
    .insert(matches)
    .values(missing.map((slot, i) => {
      // Backdated a random amount so the slots' listed ages don't move in lockstep.
      const createdAt = new Date(Date.now() - rand(0, HOSTED_AGE_CYCLE_MS));
      return {
        id: crypto.randomUUID(),
        market: slot.market,
        mode: "pulse",
        wager: slot.wager,
        timerSeconds: slot.timerSeconds,
        status: "open",
        player1Id: crypto.randomUUID(),
        player1UserId: personas[i].id,
        player1LastSeen: new Date(),
        botState: freshState(1, personas[i].skill),
        createdAt,
      };
    }))
    .onConflictDoNothing();
}

/** What the lobby list shows as a bot host's posting time (display only). */
export const listedCreatedAt = (row: MatchRow) => {
  if (row.botState === null) return row.createdAt.getTime();
  const now = Date.now();
  return now - ((now - row.createdAt.getTime()) % HOSTED_AGE_CYCLE_MS);
};

/** Deterministic per match, so every poll agrees on when the bot shows up. */
function joinDelayFor(matchId: string) {
  let hash = 0;
  for (const char of matchId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const unit = (Math.abs(hash) % 1000) / 1000;
  return JOIN_DELAY_MS[0] + unit * (JOIN_DELAY_MS[1] - JOIN_DELAY_MS[0]);
}

/**
 * A human waiting alone in `open` gets a bot opponent after a short wait.
 * Same guarded seat-taking UPDATE as a human join, so a real player who
 * arrives first still wins the seat.
 */
export async function seatBotIfWaiting(row: MatchRow): Promise<MatchRow> {
  if (row.status !== "open" || row.player2Id !== null || row.botState !== null) return row;
  if (!BOT_MARKETS.includes(row.market)) return row;
  if (Date.now() - row.createdAt.getTime() < joinDelayFor(row.id)) return row;

  const [persona] = await pickPersonas(1);
  const now = new Date();
  const [joined] = await getDb()
    .update(matches)
    .set({
      player2Id: crypto.randomUUID(),
      player2UserId: persona.id,
      player2LastSeen: now,
      status: "predict",
      predictStartAt: now,
      botState: freshState(2, persona.skill),
    })
    .where(and(eq(matches.id, row.id), eq(matches.status, "open"), sql`${matches.player2Id} IS NULL`))
    .returning();
  return joined ?? row;
}

// ---------------------------------------------------------------- trading

/**
 * One decision tick for the bot in a live round, run off the human's poll.
 * Skill shapes the habits, not the outcome — no bot sees future prices:
 * disciplined bots size small, use lower leverage, follow short-term momentum,
 * let winners run and cut losers; reckless ones max out stakes at 1000–10000×,
 * flip coins for direction, grab tiny profits and ride losses.
 * Written under a compare-and-swap on `bot_state`, so concurrent polls act once.
 */
export async function driveBot(row: MatchRow): Promise<MatchRow> {
  const state = row.botState;
  if (row.status !== "countdown" || !state || row.roundStartAt === null) return row;
  const now = Date.now();
  const roundStart = row.roundStartAt.getTime();
  const deadline = roundStart + row.timerSeconds * 1000;
  const due = state.nextActAt || roundStart + state.firstDelayMs;
  if (now < due || now >= deadline) return row;

  const product = productForMarket(row.market);
  const spot = product ? await getSpotPrice(product) : null;
  if (!spot) return row;

  const { role, skill } = state;
  const positions: PulsePosition[] = (role === 1 ? row.pulsePositions1 : row.pulsePositions2) ?? [];
  const realized = (role === 1 ? row.pulseRealizedPnl1 : row.pulseRealizedPnl2) ?? 0;
  let nextPositions = positions;
  let nextRealized = realized;

  // Exits: P&L as a fraction of the position's stake.
  const takeProfit = lerp(0.12, 0.7, skill) * rand(0.8, 1.25);
  const stopLoss = lerp(1.2, 0.3, skill) * rand(0.8, 1.25);
  const exit = positions.find((position) => {
    const ratio = pulsePositionPnl(position, spot.price) / position.stake;
    return ratio >= takeProfit || ratio <= -stopLoss;
  });

  if (exit) {
    nextPositions = positions.filter((position) => position.id !== exit.id);
    nextRealized += pulsePositionPnl(exit, spot.price);
  } else {
    const maxOpen = skill > 0.6 ? 1 + Math.round(Math.random()) : 3;
    const enterChance = lerp(0.85, 0.45, skill);
    const cash = pulseAvailableCash(positions, realized);
    const closingSoon = deadline - now < 4_000;
    if (!closingSoon && positions.length < maxOpen && cash >= 1 && Math.random() < enterChance) {
      const momentum = state.lastPrice === null ? 0 : Math.sign(spot.price - state.lastPrice);
      const followTrend = momentum !== 0 && Math.random() < lerp(0.5, 0.7, skill);
      const side = followTrend
        ? (momentum > 0 ? "long" : "short")
        : (Math.random() < 0.5 ? "long" : "short");
      const leverage = Math.random() < skill
        ? (Math.random() < 0.7 ? 100 : 1000)
        : (Math.random() < 0.5 ? 1000 : 10000);
      const fraction = lerp(rand(0.45, 1), rand(0.12, 0.35), skill);
      const stake = Math.max(1, Math.min(Math.floor(cash), Math.round(cash * fraction)));
      nextPositions = [...positions, { id: crypto.randomUUID(), side, entryPrice: spot.price, stake, leverage, openedAt: spot.at }];
    }
  }

  const nextState: BotState = {
    ...state,
    lastPrice: spot.price,
    // Reckless bots fidget; disciplined ones wait for a setup.
    nextActAt: now + Math.round(lerp(rand(1_500, 4_500), rand(3_000, 8_000), skill)),
  };
  const [updated] = await getDb()
    .update(matches)
    .set({
      botState: nextState,
      ...(role === 1
        ? { pulsePositions1: nextPositions, pulseRealizedPnl1: nextRealized }
        : { pulsePositions2: nextPositions, pulseRealizedPnl2: nextRealized }),
    })
    .where(and(
      eq(matches.id, row.id),
      eq(matches.status, "countdown"),
      sql`${matches.botState} = ${JSON.stringify(state)}::jsonb`,
      // A liquidation between this read and write must not be undone.
      pulsePositionsUnchanged(row, role),
    ))
    .returning();
  return updated ?? row;
}
