// Questions for the post-sign-up flow at /welcome — imported by both the
// client flow (app/welcome/OnboardingFlow.tsx) and the server action that
// validates and stores the answers (app/welcome/actions.ts). Rows keep the
// ids, never the copy, so labels can be reworded freely; removing or renaming
// an id orphans old answers. No server-only imports, so it stays client-safe.

export const GOALS = [
  { id: "learn", title: "Learn crypto & trading", blurb: "Get the fundamentals down and build real instincts on live markets." },
  { id: "community", title: "Find my people", blurb: "Swap calls, talk markets and hang out with other crypto traders." },
  { id: "strategies", title: "Test my strategies", blurb: "Pressure-test setups on live prices before real money is on the line." },
  { id: "profit", title: "Make money", blurb: "Win wagers, climb the ranks and earn when other traders copy my calls." },
] as const;

// `level` fills the 1–3 bar meter on each card.
export const EXPERIENCE = [
  { id: "new", level: 1, title: "Just getting started", blurb: "New to crypto or trading. Show me the ropes." },
  { id: "experienced", level: 2, title: "I know my way around", blurb: "I've traded before and can read a chart." },
  { id: "expert", level: 3, title: "Seasoned pro", blurb: "Leverage, perps, on-chain. Markets are my second language." },
] as const;

// Optional. Maps onto the game modes: quick → Pulse rounds, day → 24h Portfolio.
export const PACES = [
  { id: "quick", title: "Quick calls", blurb: "Seconds to minutes" },
  { id: "day", title: "Day trades", blurb: "In and out within a day" },
  { id: "hold", title: "Long holds", blurb: "Days, weeks or longer" },
] as const;

// Optional, single choice.
export const REFERRALS = [
  { id: "friend", title: "A friend" },
  { id: "x", title: "X / Twitter" },
  { id: "tiktok", title: "TikTok" },
  { id: "youtube", title: "YouTube" },
  { id: "instagram", title: "Instagram" },
  { id: "reddit", title: "Reddit" },
  { id: "chat", title: "Discord or Telegram" },
  { id: "search", title: "Search" },
  { id: "other", title: "Somewhere else" },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];
export type ExperienceId = (typeof EXPERIENCE)[number]["id"];
export type PaceId = (typeof PACES)[number]["id"];
export type ReferralId = (typeof REFERRALS)[number]["id"];

const ids = (options: readonly { id: string }[]) => new Set<string>(options.map((option) => option.id));
const GOAL_IDS = ids(GOALS);
const EXPERIENCE_IDS = ids(EXPERIENCE);
const PACE_IDS = ids(PACES);
const REFERRAL_IDS = ids(REFERRALS);

export const isGoal = (id: string): id is GoalId => GOAL_IDS.has(id);
export const isExperience = (id: string): id is ExperienceId => EXPERIENCE_IDS.has(id);
export const isPace = (id: string): id is PaceId => PACE_IDS.has(id);
export const isReferral = (id: string): id is ReferralId => REFERRAL_IDS.has(id);

export type OnboardingAnswers = {
  goals: GoalId[];
  experience: ExperienceId;
  paces: PaceId[];
  // TopicIds (app/lib/topics.ts) — also seeds the Omens feed's interests.
  interests: string[];
  referral: ReferralId | null;
  timezone: string | null;
};

export type FirstMove = { id: "practice" | "portfolio" | "arena" | "omens"; title: string; blurb: string; href: string };

const MOVES: Record<FirstMove["id"], FirstMove> = {
  practice: { id: "practice", title: "Try a practice round", blurb: "Call BTC's next move on live prices. Nothing at stake.", href: "/duel/btc/pulse?practice=1" },
  portfolio: { id: "portfolio", title: "Open a 24h Portfolio", blurb: "Run a day-long book of meme coins, spot or leveraged.", href: "/duel/portfolio" },
  arena: { id: "arena", title: "Enter the Arena", blurb: "Stake Embers against another trader in a live Pulse round.", href: "/duel" },
  omens: { id: "omens", title: "Read the Omens", blurb: "See what traders are calling right now, and post your own.", href: "/" },
};

/**
 * Where the finish screen points first, then the rest as secondary links.
 * Newcomers and learners practice before they wager; strategy testers who
 * trade slower get the 24h Portfolio; money goes to the Arena; community to
 * the feed.
 */
export function firstMovesFor({ goals, experience, paces }: Pick<OnboardingAnswers, "goals" | "experience" | "paces">): FirstMove[] {
  const has = (goal: GoalId) => goals.includes(goal);
  const lead: FirstMove["id"] =
    experience === "new" || has("learn") ? "practice"
    : has("strategies") ? (paces.length > 0 && !paces.includes("quick") ? "portfolio" : "practice")
    : has("profit") ? "arena"
    : "omens";
  const order: FirstMove["id"][] = [lead, ...(["arena", "omens", "practice", "portfolio"] as const).filter((id) => id !== lead)];
  return order.slice(0, 3).map((id) => MOVES[id]);
}
