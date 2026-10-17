// Mock feed content for the Global/Exclusive Twitter-style pages. No backend,
// no persistence, no posting flow yet — see docs/feeds.md.
//
// Author/handle here are plain hardcoded strings. Real posts should use Clerk
// identity (currentUser()/useUser()) for authorship — Clerk gives a
// persistent, visible name/handle, unlike the anonymous per-browser id from
// app/lib/playerId.ts, which is only meant for anonymous matchmaking.
// Trade-off for a future posting pass: signed-out visitors could view feeds
// but would need to sign in to post.
import type { TopicId } from "@/app/lib/topics";

export type Market = "btc" | "eth" | "sol" | "doge";
export type Side = "LONG" | "SHORT";
export type OutcomeStatus = "won" | "lost" | "close" | "liquidated";

// "won" = reached its target (fulfilled), "lost"/"close" = window closed short
// of it (broken), "liquidated" = price hit the liquidation level first.
// "won"/"lost" carry a dollar PnL; "close" carries a plain-language miss
// distance instead.
export type Outcome = {
  status: OutcomeStatus;
  amount?: number;
  diff?: string;
};

export type MarketCall = {
  market: Market;
  side: Side;
  leverage?: number;
  entryPrice: string;
  currentPrice: string;
  // Ends of the doom → destiny track (app/lib/calls.ts callTrack): `target`
  // is destiny; doom is whichever of `stop` / the leverage liquidation price
  // sits closer to entry.
  stop?: number;
  target: number;
  outcome?: Outcome;
  // Only meaningful while `outcome` is unset — a resolved call has nothing
  // left to count down. Static display string, not a live countdown.
  expiresIn?: string;
  // Full call window in minutes; the time ring drains expiresIn / windowMin.
  windowMin?: number;
  // Shown as "N tailing" under the Copy button (pending calls only). Hand-picked to
  // scale with the author's rank — the button copies nothing and nothing
  // increments this.
  copiedBy?: number;
};

// Placeholder media standing in for real image uploads (no asset pipeline
// yet), drawn in HTML/SVG by app/PostMedia.tsx. Most kinds mimic the
// screenshots people paste into posts on X; none of it is live data:
// - "meme": gradient tile (keyed off `seed`, like the avatar gradient) with a
//   big emoji and optional top/bottom caption.
// - "candles": exchange chart screenshot. Candles are seeded noise around
//   `path` (anchor closes, evenly spaced, last one = final close); `spike`
//   forces one wick (`at` = 0–1 along the chart), `level` draws a labelled
//   horizontal line, `note` circles the last candles in red marker.
// - "post": someone else's post, screenshotted. "headline": a news article.
// - "pnl": share card for a closed trade (`roi` in %). "chat": a messaging
//   thread (`me` = right-hand bubbles). "orderbook": asks high→low, bids
//   high→low as [price, size], `wall` highlighted. "bars": dashboard bar
//   chart (negative values turn the chart into green/red flows).
// - "explorer": block-explorer transaction page.
// `alt` is the accessible description (the media renders as role="img").
export type PostImage = { alt: string } & (
  | { kind: "meme"; seed: string; emoji: string; top?: string; bottom?: string }
  | { kind: "candles"; seed: string; pair: string; interval: string; path: number[]; level?: { price: number; label: string }; spike?: { at: number; price: number }; note?: string }
  | { kind: "post"; author: string; handle: string; avatarInitial: string; content: string; date: string; views: string; replies: number; reposts: number; likes: number }
  | { kind: "headline"; outlet: string; section: string; headline: string; dek: string; byline: string; time: string }
  | { kind: "pnl"; pair: string; side: Side; leverage?: number; roi: number; entry: string; exit: string; handle: string }
  | { kind: "chat"; title: string; subtitle: string; time: string; messages: { text: string; me?: boolean }[] }
  | { kind: "orderbook"; pair: string; group: string; asks: [number, number][]; bids: [number, number][]; wall: number; last: string; note?: string }
  | { kind: "bars"; title: string; subtitle: string; source: string; unit: "B" | "M"; bars: { label: string; value: number }[] }
  | { kind: "explorer"; network: string; hash: string; block: string; age: string; from: string; fromTag: string; to: string; value: string; usd: string; fee: string }
);

// Every post renders through PostCard, which branches on `kind`:
// "text" = plain take, "call"/"result" = market-call hero (pending vs
// resolved), "streak" = compact highlight banner, "promo" = quiet system
// line with no avatar/actions, "clash" = two opposing calls you can side with.
export type PostKind = "text" | "call" | "result" | "streak" | "promo" | "clash";

// Omen Clash: two players called opposite sides of the same print. `votes` is
// the crowd siding with each (hand-picked); voting in the UI adds one local
// vote and settles nothing.
export type ClashSide = { name: string; handle: string; direction: "up" | "down"; target: string; votes: number };
export type Clash = { market: Market; deadline: string; sides: [ClashSide, ClashSide] };

// Short tag at the right of a post's meta row (app/PostCard.tsx FLAIRS).
// Hand-assigned in the mock — no engagement or recommendation signal
// computes it.
export type PostFlair = "forYou" | "engaging" | "copying" | "followed";

export type Post = {
  id: string;
  author: string;
  handle: string;
  avatarInitial: string;
  content: string;
  timestamp: string;
  likes: number;
  replies: number;
  // Display-only repost counts, summed on the Repost button and listed per
  // kind in its menu (app/RepostMenu.tsx); nothing increments them. All three
  // are reposts to your followers: plain, Vouch = one you back, Defy = one
  // you're against. No mock post sets `reposts` yet.
  reposts?: number;
  vouches?: number;
  defies?: number;
  kind: PostKind;
  rank?: string;
  call?: MarketCall;
  // One item renders full width; 2–4 tile into an X-style grid.
  media?: PostImage[];
  streakStat?: string;
  // Coin this post is about, for posts without a `call` (a call's own
  // `call.market` already implies it). Maps onto a coin topic in
  // app/lib/topics.ts postTopics().
  market?: Market;
  // Hand-tagged interest topics (companies, people, themes, extra coins) for
  // the For You covers and topic chips. The market's coin is added on top.
  topics?: TopicId[];
  flair?: PostFlair;
  clash?: Clash;
  // Written by the viewer (FeedComposer posts): deletable from the ⋯ menu,
  // and it can be reposted but not vouched for or defied.
  mine?: boolean;
};

// Platform-wide count beside "Live Calls" in the feed rail — a hardcoded
// mock, not derived from the posts below.
export const LIVE_CALL_COUNT = 214;

// Drives the "Following" feed filter (app/FeedSwitcher.tsx) — not a real
// social graph, just a hardcoded handle allowlist for the mock.
export const FOLLOWED_HANDLES = ["@nova_trades", "@ren.eth", "@zane_lfg"];

// A vouch or defy someone made, as it lands in their followers' feeds: the
// original post under "Nova vouched for this omen" / "Zane defied this omen".
// Both are plain reposts (a defy just says you're against it). Newest first;
// hand-written.
export type Share = {
  id: string;
  kind: "vouch" | "defy";
  postId: string;
  name: string;
  handle: string;
  timestamp: string;
};

export const SHARES: Share[] = [
  { id: "sh1", kind: "defy", postId: "g-oracle1", name: "Zane", handle: "@zane_lfg", timestamp: "1m ago" },
  { id: "sh2", kind: "defy", postId: "t-near", name: "Nova", handle: "@nova_trades", timestamp: "5m ago" },
  { id: "sh3", kind: "vouch", postId: "n4", name: "Nova", handle: "@nova_trades", timestamp: "8m ago" },
  { id: "sh4", kind: "vouch", postId: "s-sol3", name: "Ren", handle: "@ren.eth", timestamp: "12m ago" },
  { id: "sh5", kind: "vouch", postId: "c-cb1", name: "Zane", handle: "@zane_lfg", timestamp: "15m ago" },
  { id: "sh6", kind: "defy", postId: "hy1", name: "Ren", handle: "@ren.eth", timestamp: "30m ago" },
];

export type Reply = {
  id: string;
  author: string;
  handle: string;
  avatarInitial: string;
  content: string;
  timestamp: string;
  likes: number;
};

// Replies shown when a post's thread is expanded (app/PostCard.tsx's
// ReplyThread, toggled by the Reply action). Keyed by Post.id, a handful of
// loaded replies per post — independent of Post.replies (the decorative
// total count), same "not every reply is fetched" shorthand every real feed
// uses. Posts with no entry here render an empty-state instead.
export const POST_REPLIES: Record<string, Reply[]> = {
  gs1: [
    { id: "gs1-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "Dormant coins moving is usually custody shuffling, not selling. Relax.", timestamp: "2m ago", likes: 38 },
    { id: "gs1-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "imagine finding that hard drive in a drawer 😭", timestamp: "1m ago", likes: 21 },
  ],
  "t-near": [
    { id: "t-near-r1", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "Add margin or say goodbye. Those are the options.", timestamp: "6m ago", likes: 14 },
    { id: "t-near-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "the 12 ppl tailing this are braver than marines", timestamp: "5m ago", likes: 30 },
  ],
  n1: [
    { id: "n1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "the 2pm candle is the only honest part of the day", timestamp: "5m ago", likes: 11 },
    { id: "n1-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "already drafting my priced in thread tbh", timestamp: "4m ago", likes: 19 },
  ],
  n2: [
    { id: "n2-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "Maintenance = when the order book gets too honest", timestamp: "11m ago", likes: 42 },
    { id: "n2-r2", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "keep size on 2 venues. learned that one the hard way", timestamp: "9m ago", likes: 27 },
  ],
  n4: [
    { id: "n4-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "Agreed, and most of it is sitting on exchanges, not in DeFi.", timestamp: "20m ago", likes: 96 },
    { id: "n4-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "tl will notice right after the move as usual", timestamp: "18m ago", likes: 51 },
    { id: "n4-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "Saving this for when someone asks where the bid came from.", timestamp: "15m ago", likes: 33 },
  ],
  g1: [
    { id: "g1-r1", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "LFG 🔥", timestamp: "1m ago", likes: 4 },
    { id: "g1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "shouldve sized up on this one ngl", timestamp: "1m ago", likes: 2 },
    { id: "g1-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "6 for 6 this week, insane.", timestamp: "45s ago", likes: 1 },
  ],
  g2: [
    { id: "g2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "hang in there still time on the clock", timestamp: "3m ago", likes: 2 },
    { id: "g2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "25x on eth rn is crazy work", timestamp: "2m ago", likes: 1 },
  ],
  g3: [
    { id: "g3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "this is actually a good take wtf", timestamp: "8m ago", likes: 5 },
    { id: "g3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "read the whole thing. u had me at tl;dr", timestamp: "7m ago", likes: 1 },
    { id: "g3-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "ser this is a tweet not a blog", timestamp: "5m ago", likes: 3 },
  ],
  g7: [
    { id: "g7-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "dip buyers eating good fr", timestamp: "10m ago", likes: 9 },
    { id: "g7-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "reclaim looks clean ngl", timestamp: "9m ago", likes: 4 },
    { id: "g7-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "Loaded more at 66.8.", timestamp: "6m ago", likes: 2 },
  ],
  g8: [
    { id: "g8-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "lmaooo felt this", timestamp: "16m ago", likes: 21 },
    { id: "g8-r2", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "doge gang stays coping", timestamp: "14m ago", likes: 33 },
    { id: "g8-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "this is a mood", timestamp: "9m ago", likes: 12 },
  ],
  g4: [
    { id: "g4-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "so close, brutal", timestamp: "22m ago", likes: 1 },
  ],
  g9: [
    { id: "g9-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "sizing down ty", timestamp: "28m ago", likes: 6 },
    { id: "g9-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "violent move either way 100%", timestamp: "25m ago", likes: 3 },
  ],
  g5: [
    { id: "g5-r1", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "same ive been checking every patch note", timestamp: "30m ago", likes: 3 },
    { id: "g5-r2", author: "ArenaBot", handle: "@arenabot", avatarInitial: "A", content: "Still cooking. No ETA yet.", timestamp: "20m ago", likes: 8 },
  ],
  "g-oracle1": [
    { id: "g-oracle1-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "tailing, stops tight enough to size", timestamp: "3m ago", likes: 48 },
    { id: "g-oracle1-r2", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "That wall has been sitting there ALL morning 👀", timestamp: "2m ago", likes: 31 },
    { id: "g-oracle1-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "18k people on one side is either genius or the top.", timestamp: "1m ago", likes: 22 },
  ],
  "g-diamond1": [
    { id: "g-diamond1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "spot volume is the tell yeah", timestamp: "9m ago", likes: 14 },
    { id: "g-diamond1-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "copied at 3410 lfg", timestamp: "6m ago", likes: 9 },
  ],
  "s-sol1": [
    { id: "s-sol1-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "clean. where was invalidation?", timestamp: "3m ago", likes: 18 },
    { id: "s-sol1-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "trenches stay undefeated", timestamp: "2m ago", likes: 26 },
  ],
  ob1: [
    { id: "ob1-r1", author: "Vesper", handle: "@vesper", avatarInitial: "V", content: "gets pulled the second price gets close. always does", timestamp: "10m ago", likes: 64 },
    { id: "ob1-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "1200 btc of pure intimidation", timestamp: "9m ago", likes: 22 },
  ],
  ethbtc: [
    { id: "ethbtc-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "The ratio bottoms when nobody posts about it, so not today.", timestamp: "11m ago", likes: 140 },
    { id: "ethbtc-r2", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "My sleep schedule has better higher lows than this.", timestamp: "10m ago", likes: 96 },
  ],
  mm1: [
    { id: "mm1-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "the second screenshot is the real content", timestamp: "16m ago", likes: 210 },
    { id: "mm1-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "GOBLIN holders are a different breed", timestamp: "14m ago", likes: 88 },
  ],
  "p-saylor1": [
    { id: "p-saylor1-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "The dots are the most reliable calendar in crypto.", timestamp: "22m ago", likes: 74 },
    { id: "p-saylor1-r2", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "Filing drops before the open, set your alarms", timestamp: "20m ago", likes: 41 },
  ],
  "c-cb1": [
    { id: "c-cb1-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "The pilates friend is ALWAYS the signal", timestamp: "25m ago", likes: 312 },
    { id: "c-cb1-r2", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "Send her the DCA talk, not the 100k talk.", timestamp: "23m ago", likes: 158 },
  ],
  "s-sol2": [
    { id: "s-sol2-r1", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "tailing. 146 stop is tight but fair", timestamp: "26m ago", likes: 33 },
    { id: "s-sol2-r2", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "sol/eth looks ready too", timestamp: "24m ago", likes: 19 },
  ],
  "m-macro1": [
    { id: "m-macro1-r1", author: "Vesper", handle: "@vesper", avatarInitial: "V", content: "3 cuts priced, 0 delivered. classic", timestamp: "31m ago", likes: 120 },
    { id: "m-macro1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "bonds and btc agreeing for once", timestamp: "29m ago", likes: 47 },
  ],
  "a-ai2": [
    { id: "a-ai2-r1", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "The haiku is honestly bullish.", timestamp: "45m ago", likes: 133 },
    { id: "a-ai2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "\"community energy\" im crying", timestamp: "44m ago", likes: 90 },
  ],
  pp1: [
    { id: "pp1-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "the frog is the only chart that respects me", timestamp: "5m ago", likes: 140 },
    { id: "pp1-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "sold at +12% like a responsible adult. never again", timestamp: "4m ago", likes: 96 },
  ],
  bk1: [
    { id: "bk1-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "spot no leverage 3x. this is the way", timestamp: "19m ago", likes: 58 },
    { id: "bk1-r2", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "Dog coins rotating... WIF next?", timestamp: "17m ago", likes: 31 },
  ],
  wf1: [
    { id: "wf1-r1", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "hat is glued on at this point", timestamp: "30m ago", likes: 44 },
  ],
  hy1: [
    { id: "hy1-r1", author: "Vesper", handle: "@vesper", avatarInitial: "V", content: "range high is 40. want a weekly close above it first", timestamp: "41m ago", likes: 72 },
    { id: "hy1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "buybacks are the best tokenomics nobody tweets about", timestamp: "39m ago", likes: 38 },
  ],
  r1: [
    { id: "r1-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "Funding is what longs pay shorts (or the reverse) to hold perps. When it flips hot, everyone's leaning long, and that's what people like Vesper fade.", timestamp: "5m ago", likes: 41 },
    { id: "r1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "welcome anon. dont ask why the coin u bought went down, it just does", timestamp: "4m ago", likes: 12 },
  ],
  r3: [
    { id: "r3-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "\"i said yes\" 😭😭", timestamp: "24m ago", likes: 77 },
    { id: "r3-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "same energy as its not a loss until u sell", timestamp: "22m ago", likes: 35 },
  ],
  e1: [
    { id: "e1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "exclusive feed reads diff fr", timestamp: "3m ago", likes: 6 },
    { id: "e1-r2", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "Watching for the same pullback.", timestamp: "2m ago", likes: 2 },
  ],
  e2: [
    { id: "e2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "volatility got u this time", timestamp: "14m ago", likes: 3 },
    { id: "e2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "high rank lobby is no joke", timestamp: "11m ago", likes: 5 },
  ],
  e3: [
    { id: "e3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "Congrats, queue is way faster up here", timestamp: "35m ago", likes: 4 },
    { id: "e3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "gg see u in exclusive", timestamp: "30m ago", likes: 2 },
  ],
};

export const GLOBAL_POSTS: Post[] = [
  {
    id: "g-oracle1",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "funding flipped hot and that 68.5k wall hasnt moved in 6 hours. fading this pump, stop above 69.2k",
    timestamp: "2m ago",
    likes: 1284,
    replies: 216,
    vouches: 88,
    defies: 142,
    kind: "call",
    rank: "Oracle",
    flair: "copying",
    call: {
      market: "btc",
      side: "SHORT",
      leverage: 20,
      entryPrice: "68,420",
      currentPrice: "68,190",
      stop: 69200,
      target: 67600,
      windowMin: 240,
      expiresIn: "1h 55m",
      copiedBy: 18400,
    },
  },
  {
    id: "gs1",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "A wallet that's been dormant since 2014 just moved its ENTIRE btc stack 👀 either an OG miner woke up or someone found a hard drive in their moms basement. CT already calling the top lol",
    timestamp: "3m ago",
    likes: 356,
    replies: 48,
    vouches: 72,
    defies: 24,
    kind: "text",
    rank: "Gold I",
    flair: "engaging",
    market: "btc",
    media: [
      {
        kind: "explorer",
        alt: "Block explorer page for a 1,000 BTC transfer out of a wallet tagged dormant since 2014",
        network: "Bitcoin",
        hash: "7f3c9a1d…e41b02",
        block: "971,482",
        age: "4 mins ago",
        from: "1Fz8Rk…q3Wd",
        fromTag: "Dormant since 2014",
        to: "bc1qm4…8v2d",
        value: "1,000 BTC",
        usd: "$68,190,000",
        fee: "0.00021 BTC",
      },
    ],
  },
  {
    id: "s-sol1",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "called the sol breakout at 146 and rode it str8 to target. told yall the trenches were waking up 🫡",
    timestamp: "4m ago",
    likes: 930,
    replies: 64,
    vouches: 41,
    defies: 20,
    kind: "result",
    rank: "Bronze II",
    call: {
      market: "sol",
      side: "LONG",
      leverage: 25,
      entryPrice: "146.20",
      currentPrice: "148.90",
      stop: 143.5,
      target: 148.9,
      outcome: { status: "won", amount: 820 },
    },
  },
  {
    id: "g1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "3 for 3 on btc today. cast is PRINTING",
    timestamp: "5m ago",
    likes: 41,
    replies: 6,
    vouches: 3,
    defies: 1,
    kind: "result",
    rank: "Gold II",
    call: {
      market: "btc",
      side: "LONG",
      leverage: 10,
      entryPrice: "67,240",
      currentPrice: "68,451",
      stop: 66500,
      target: 68400,
      outcome: { status: "won", amount: 4200 },
    },
  },
  {
    id: "g-clash1",
    author: "Omen Clash",
    handle: "@omenclash",
    avatarInitial: "⚔",
    content: "Nova and Vesper called opposite sides of BTC's 6:00 PM print.",
    timestamp: "6m ago",
    likes: 0,
    replies: 0,
    kind: "clash",
    market: "btc",
    clash: {
      market: "btc",
      deadline: "6:00 PM",
      sides: [
        { name: "Nova", handle: "@nova_trades", direction: "up", target: "69.5k", votes: 794 },
        { name: "Vesper", handle: "@vesper", direction: "down", target: "67.6k", votes: 487 },
      ],
    },
  },
  {
    id: "r1",
    author: "kev",
    handle: "@kevdoescrypto",
    avatarInitial: "K",
    content: "noob question but what does \"funding flipped\" actually mean. everyone says it like im supposed to know 😭",
    timestamp: "6m ago",
    likes: 14,
    replies: 23,
    vouches: 0,
    defies: 0,
    kind: "text",
    rank: "Bronze I",
  },
  {
    id: "gs2",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "two diff people told me a big exchange is listing a dog coin next week so either its the worst kept secret in crypto or nobody actually knows anything (its the second one)",
    timestamp: "7m ago",
    likes: 188,
    replies: 39,
    vouches: 21,
    defies: 7,
    kind: "text",
    rank: "Silver II",
    market: "doge",
    topics: ["memecoins"],
  },
  {
    id: "pp1",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "The frog never actually leaves... it just waits for you to sell 🐸 +40% on the week btw",
    timestamp: "7m ago",
    likes: 2400,
    replies: 190,
    vouches: 520,
    defies: 88,
    kind: "text",
    rank: "Gold I",
    flair: "engaging",
    topics: ["pepe", "memecoins"],
    media: [{ kind: "meme", alt: "Frog emoji meme captioned frog season, it never left", seed: "frog-season", emoji: "🐸", top: "Frog season", bottom: "It never left" }],
  },
  {
    id: "t-near",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "went 50x on eth bc the chart \"looked ready\". chart was not ready. if this candle closes green im framing it",
    timestamp: "8m ago",
    likes: 77,
    replies: 24,
    vouches: 6,
    defies: 31,
    kind: "call",
    rank: "Bronze II",
    call: {
      market: "eth",
      side: "LONG",
      leverage: 50,
      entryPrice: "3,441",
      currentPrice: "3,383",
      target: 3520,
      expiresIn: "22m",
      windowMin: 120,
      copiedBy: 12,
    },
  },
  {
    id: "n1",
    author: "Lena",
    handle: "@lena_q",
    avatarInitial: "L",
    content: "Rate decision tomorrow. Everyone pretending they're not positioned for a cut. Same script every time: chop all morning, one big candle at 2pm, then fifty \"it was priced in\" threads by 2:15.",
    timestamp: "9m ago",
    likes: 88,
    replies: 14,
    vouches: 9,
    defies: 1,
    kind: "text",
    rank: "Silver III",
    topics: ["macro"],
  },
  {
    id: "g-diamond1",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "ETH reclaimed the weekly open on actual spot volume. Riding it to 3.5k, invalidation under 3,380. Simple as.",
    timestamp: "10m ago",
    likes: 486,
    replies: 64,
    vouches: 37,
    defies: 54,
    kind: "call",
    rank: "Diamond II",
    call: {
      market: "eth",
      side: "LONG",
      leverage: 15,
      entryPrice: "3,402",
      currentPrice: "3,436",
      stop: 3380,
      target: 3500,
      windowMin: 480,
      expiresIn: "4h 20m",
      copiedBy: 7200,
    },
  },
  {
    id: "gs3",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "watching a big account quietly delete last weeks \"btc to 50k\" call lmao. anon the internet remembers. screenshots are forever",
    timestamp: "11m ago",
    likes: 97,
    replies: 16,
    vouches: 12,
    defies: 5,
    kind: "text",
    rank: "Silver I",
    flair: "followed",
    market: "btc",
    media: [
      {
        kind: "post",
        alt: "Screenshot of a since-deleted post by @atlasmacro: BTC goes to 50k before it ever sees 75k. Bookmark this.",
        author: "Atlas Macro",
        handle: "@atlasmacro",
        avatarInitial: "A",
        content: "BTC goes to 50k before it ever sees 75k. Bookmark this.",
        date: "9:14 AM · Sep 28, 2026",
        views: "1.2M",
        replies: 3400,
        reposts: 2100,
        likes: 18000,
      },
    ],
  },
  {
    id: "r2",
    author: "maya 🌙",
    handle: "@mayaonchain",
    avatarInitial: "M",
    content: "we are so back",
    timestamp: "11m ago",
    likes: 212,
    replies: 18,
    vouches: 31,
    defies: 9,
    kind: "text",
    rank: "Silver I",
    market: "btc",
  },
  {
    id: "ob1",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "That 68.5k ask wall everyone's been staring at?? Still there. 1,200 BTC that hasn't blinked since this morning... spoofer or whale, you decide",
    timestamp: "12m ago",
    likes: 422,
    replies: 51,
    vouches: 38,
    defies: 12,
    kind: "text",
    rank: "Gold I",
    market: "btc",
    media: [
      {
        kind: "orderbook",
        alt: "BTC-USD order book grouped by 50 with a 1,214 BTC ask at 68,500 dwarfing every other level",
        pair: "BTC-USD",
        group: "50",
        asks: [
          [68500, 1214.3],
          [68450, 18.6],
          [68400, 42.1],
          [68350, 9.8],
          [68300, 27.4],
          [68250, 12.9],
        ],
        bids: [
          [68200, 31.7],
          [68150, 14.2],
          [68100, 56.9],
          [68050, 8.3],
          [68000, 88.5],
        ],
        wall: 68500,
        last: "68,214.5",
        note: "still there",
      },
    ],
  },
  {
    id: "ethbtc",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "eth/btc printed a lower low every month this year and my eth bags still think its 2021. someone pls tell me the bottom is in 🥲",
    timestamp: "13m ago",
    likes: 3100,
    replies: 188,
    vouches: 72,
    defies: 22,
    kind: "text",
    rank: "Silver I",
    topics: ["ethereum"],
    media: [
      {
        kind: "candles",
        alt: "ETH/BTC daily chart sliding from 0.061 to 0.050, with the latest candles circled and the note bottom??",
        seed: "ethbtc",
        pair: "ETH/BTC",
        interval: "1D",
        path: [0.0612, 0.0598, 0.0603, 0.0581, 0.0566, 0.0571, 0.0549, 0.0532, 0.0504],
        level: { price: 0.05, label: "support?" },
        note: "bottom??",
      },
    ],
  },
  {
    id: "g8",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "me explaining to my portfolio why im still long doge 😭",
    timestamp: "13m ago",
    likes: 302,
    replies: 41,
    vouches: 140,
    defies: 43,
    kind: "text",
    rank: "Silver II",
    flair: "engaging",
    media: [{ kind: "meme", alt: "A dog emoji on a gradient", seed: "doge-cope", emoji: "🐕" }],
    market: "doge",
    topics: ["memecoins"],
  },
  {
    id: "t-liq",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "got liqd on a 30 second wick lmao. 40x was a choice i guess. back to spot like a responsable adult",
    timestamp: "14m ago",
    likes: 129,
    replies: 27,
    vouches: 14,
    defies: 8,
    kind: "result",
    rank: "Bronze III",
    call: {
      market: "eth",
      side: "LONG",
      leverage: 40,
      entryPrice: "3,428",
      currentPrice: "3,342",
      target: 3520,
      outcome: { status: "liquidated" },
    },
  },
  {
    id: "n2",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "another big exchange went down for \"scheduled maintenance\" right as btc ripped 3%. funny how maintenance never happens on a quiet sunday huh",
    timestamp: "15m ago",
    likes: 412,
    replies: 57,
    vouches: 61,
    defies: 13,
    kind: "text",
    rank: "Bronze II",
    flair: "engaging",
    market: "btc",
  },
  {
    id: "g-streak1",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "called btc's close AGAIN before the 11:59 bell. streak still alive. dont talk to me",
    timestamp: "16m ago",
    likes: 76,
    replies: 9,
    vouches: 11,
    defies: 4,
    kind: "streak",
    rank: "Gold I",
    streakStat: "6-day streak",
    market: "btc",
  },
  {
    id: "g2",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "pulse leverage on eth is nasty rn. down 0.4 and im sweating thru my shirt",
    timestamp: "17m ago",
    likes: 18,
    replies: 3,
    vouches: 4,
    defies: 3,
    kind: "call",
    rank: "Silver I",
    call: {
      market: "eth",
      side: "LONG",
      leverage: 25,
      entryPrice: "3,428",
      currentPrice: "3,412",
      stop: 3380,
      target: 3520,
      windowMin: 360,
      expiresIn: "3h 40m",
      copiedBy: 340,
    },
  },
  {
    id: "mm1",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "turned 200 into 3.1k on a coin called GOBLIN then gave half of it back in ONE candle. the trenches give and teh trenches take",
    timestamp: "18m ago",
    likes: 2600,
    replies: 310,
    vouches: 420,
    defies: 159,
    kind: "text",
    rank: "Bronze III",
    flair: "engaging",
    topics: ["memecoins"],
    media: [
      {
        kind: "pnl",
        alt: "PnL card: GOBLIN/USD spot long, +1,450%",
        pair: "GOBLIN/USD",
        side: "LONG",
        roi: 1450.2,
        entry: "0.000412",
        exit: "0.006387",
        handle: "@8bitkay",
      },
      {
        kind: "pnl",
        alt: "PnL card: GOBLIN/USD spot long, −48.2%",
        pair: "GOBLIN/USD",
        side: "LONG",
        roi: -48.2,
        entry: "0.006120",
        exit: "0.003170",
        handle: "@8bitkay",
      },
    ],
  },
  {
    id: "n4",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "stablecoin supply at a new ath while the tl argues about memecoins. dry powder doesnt sit on the sidelines forever. this is the chart im watching this week, not eth/btc",
    timestamp: "19m ago",
    likes: 2140,
    replies: 188,
    vouches: 304,
    defies: 123,
    kind: "text",
    rank: "Oracle",
    flair: "followed",
    topics: ["defi"],
    media: [
      {
        kind: "bars",
        alt: "Bar chart of total stablecoin supply rising every month for a year to a new high of 333 billion dollars",
        title: "Stablecoin supply",
        subtitle: "Total market cap, monthly",
        source: "Onchain data · Oct 5",
        unit: "B",
        bars: [
          { label: "Nov", value: 262 },
          { label: "Dec", value: 268 },
          { label: "Jan", value: 271 },
          { label: "Feb", value: 279 },
          { label: "Mar", value: 284 },
          { label: "Apr", value: 290 },
          { label: "May", value: 297 },
          { label: "Jun", value: 301 },
          { label: "Jul", value: 309 },
          { label: "Aug", value: 316 },
          { label: "Sep", value: 324 },
          { label: "Oct", value: 333 },
        ],
      },
    ],
  },
  {
    id: "s-sol3",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "Biggest two weeks of the year for Solana launchpad volume. You can hate the coins all you want, the rails are getting used.",
    timestamp: "20m ago",
    likes: 512,
    replies: 47,
    vouches: 96,
    defies: 9,
    kind: "text",
    rank: "Diamond II",
    market: "sol",
    topics: ["memecoins"],
    media: [
      {
        kind: "bars",
        alt: "Bar chart of daily Solana launchpad volume climbing from 182 to 448 million dollars over two weeks",
        title: "Launchpad volume",
        subtitle: "Solana, daily",
        source: "Onchain data · Oct 5",
        unit: "M",
        bars: [
          { label: "9/22", value: 182 },
          { label: "9/23", value: 205 },
          { label: "9/24", value: 171 },
          { label: "9/25", value: 240 },
          { label: "9/26", value: 266 },
          { label: "9/27", value: 231 },
          { label: "9/28", value: 298 },
          { label: "9/29", value: 312 },
          { label: "9/30", value: 287 },
          { label: "10/1", value: 344 },
          { label: "10/2", value: 371 },
          { label: "10/3", value: 356 },
          { label: "10/4", value: 402 },
          { label: "10/5", value: 448 },
        ],
      },
    ],
  },
  {
    id: "g3",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: `ok long post but hear me out on base season

everyone keeps asking which token is gonna 10x but i think thats the wrong question. whats actually different this time is people are using stuff on a normal tuesday?? games, social apps, weird little experiments, not just another dex dashboard with a different logo. onboarding is stupid easy now which helps alot

my honest take is the teams that ship thru the boring weeks win and the ones that sprint for a week and dissapear dont. same with communities. the ones that make new ppl feel like participants and not exit liquidity are gonna be the ones still here next year

idk maybe im coping but id rather follow builders than candles

tl;dr base season = consistency > hype. nfa`,
    timestamp: "21m ago",
    likes: 63,
    replies: 12,
    vouches: 9,
    defies: 3,
    kind: "text",
    rank: "Bronze III",
    flair: "forYou",
    topics: ["coinbase", "ethereum"],
  },
  {
    id: "bk1",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "first bonk trade since last cycle and its up 212% 😭 sol dog coins never die they just go quiet for a bit",
    timestamp: "21m ago",
    likes: 1300,
    replies: 110,
    vouches: 240,
    defies: 67,
    kind: "text",
    rank: "Bronze II",
    topics: ["bonk", "solana", "memecoins"],
    media: [
      {
        kind: "pnl",
        alt: "PnL card: BONK/USD spot long, +212%",
        pair: "BONK/USD",
        side: "LONG",
        roi: 212.4,
        entry: "0.00001840",
        exit: "0.00005748",
        handle: "@tobi.sol",
      },
    ],
  },
  {
    id: "g-clash2",
    author: "Omen Clash",
    handle: "@omenclash",
    avatarInitial: "⚔",
    content: "Juno and Ren split on where ETH closes tonight.",
    timestamp: "22m ago",
    likes: 0,
    replies: 0,
    kind: "clash",
    market: "eth",
    clash: {
      market: "eth",
      deadline: "midnight",
      sides: [
        { name: "Juno", handle: "@juno_dx", direction: "up", target: "3.5k", votes: 412 },
        { name: "Ren", handle: "@ren.eth", direction: "down", target: "3.35k", votes: 598 },
      ],
    },
  },
  {
    id: "t-broken",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "doge never made it to 0.132 before the window closed. thesis was right clock was wrong. thats what im telling myself anyway",
    timestamp: "23m ago",
    likes: 64,
    replies: 11,
    vouches: 3,
    defies: 1,
    kind: "result",
    rank: "Silver II",
    call: {
      market: "doge",
      side: "LONG",
      leverage: 5,
      entryPrice: "0.1240",
      currentPrice: "0.1215",
      stop: 0.118,
      target: 0.132,
      outcome: { status: "lost", amount: 51 },
    },
    topics: ["memecoins"],
  },
  {
    id: "gs4",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "is it just me or does every new L2 launch come with a points program, a mascot, and a discord thats 90% airdrop farmers. like bro",
    timestamp: "24m ago",
    likes: 274,
    replies: 33,
    vouches: 19,
    defies: 3,
    kind: "text",
    rank: "Gold I",
    topics: ["airdrops", "ethereum"],
  },
  {
    id: "p-saylor1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "saylor posted the orange dots on a sunday again. u already know what this mornings filing says 🟠",
    timestamp: "25m ago",
    likes: 1800,
    replies: 150,
    vouches: 260,
    defies: 85,
    kind: "text",
    rank: "Gold II",
    topics: ["saylor", "bitcoin"],
  },
  {
    id: "g7",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "BTC reclaiming 68k like it's nothing. Dip buyers eating GOOD this week 🍽️",
    timestamp: "26m ago",
    likes: 134,
    replies: 22,
    vouches: 12,
    defies: 1,
    kind: "text",
    rank: "Gold I",
    media: [
      {
        kind: "candles",
        alt: "BTC/USD hourly chart grinding up from 65.1k and closing back above a 68k line labelled reclaimed",
        seed: "btc-reclaim",
        pair: "BTC/USD",
        interval: "1h",
        path: [65100, 65600, 65300, 66200, 67000, 66800, 67600, 68400],
        level: { price: 68000, label: "reclaimed" },
      },
    ],
    market: "btc",
  },
  {
    id: "r3",
    author: "degen dad",
    handle: "@degendad_eth",
    avatarInitial: "D",
    content: "told my wife the eth is \"long term\". she asked how long. i said yes",
    timestamp: "26m ago",
    likes: 890,
    replies: 47,
    vouches: 120,
    defies: 24,
    kind: "text",
    rank: "Silver II",
    topics: ["ethereum"],
  },
  {
    id: "c-cb1",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "my mom just texted me asking how to buy bitcoin on coinbase. im not saying its the top. im just saying ive seen this text before",
    timestamp: "27m ago",
    likes: 4200,
    replies: 260,
    vouches: 980,
    defies: 171,
    kind: "text",
    rank: "Silver II",
    flair: "engaging",
    topics: ["coinbase"],
    media: [
      {
        kind: "chat",
        alt: "Text thread with Mom asking how to buy bitcoin on Coinbase because a friend from pilates says it's going to 100 thousand",
        title: "Mom",
        subtitle: "Mobile",
        time: "Today 9:41 AM",
        messages: [
          { text: "hi sweetie how do i buy the bitcoin on coinbase" },
          { text: "my friend from pilates says its going to 100" },
          { text: "100 thousand i mean" },
          { text: "mom please no", me: true },
        ],
      },
    ],
  },
  {
    id: "n3",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "Unpopular opinion: daily ETF flow numbers are the most overrated stat in crypto. Inflows tell you who already bought, not who's about to sell. Watch the basis.",
    timestamp: "28m ago",
    likes: 231,
    replies: 29,
    vouches: 18,
    defies: 41,
    kind: "text",
    rank: "Diamond II",
    market: "btc",
    topics: ["blackrock"],
    media: [
      {
        kind: "bars",
        alt: "Bar chart of daily spot bitcoin ETF net flows over two weeks, flipping between inflows and outflows",
        title: "Spot BTC ETF net flows",
        subtitle: "All US funds, daily",
        source: "Fund disclosures · Oct 3",
        unit: "M",
        bars: [
          { label: "9/22", value: 412 },
          { label: "9/23", value: -186 },
          { label: "9/24", value: 238 },
          { label: "9/25", value: -94 },
          { label: "9/26", value: 156 },
          { label: "9/29", value: 521 },
          { label: "9/30", value: -312 },
          { label: "10/1", value: 88 },
          { label: "10/2", value: 274 },
          { label: "10/3", value: -142 },
        ],
      },
    ],
  },
  {
    id: "s-sol2",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "sol held 148 on the retest 3 times. long into the week. target 162, out under 146",
    timestamp: "29m ago",
    likes: 1650,
    replies: 140,
    vouches: 120,
    defies: 96,
    kind: "call",
    rank: "Oracle",
    flair: "copying",
    call: {
      market: "sol",
      side: "LONG",
      leverage: 10,
      entryPrice: "148.60",
      currentPrice: "151.30",
      stop: 146,
      target: 162,
      windowMin: 720,
      expiresIn: "9h 40m",
      copiedBy: 9600,
    },
  },
  {
    id: "gs5",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "real question for the tl: whats ur rule for taking profit? mine is sell a third at 2x and pretend the rest is already zero",
    timestamp: "30m ago",
    likes: 143,
    replies: 61,
    vouches: 8,
    defies: 2,
    kind: "text",
    rank: "Gold II",
  },
  {
    id: "p-elon1",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "ONE dog meme from elon and doge does 8% in 4 minutes LMAO. no other asset on earth trades on vibes this pure",
    timestamp: "31m ago",
    likes: 1500,
    replies: 140,
    vouches: 210,
    defies: 68,
    kind: "text",
    rank: "Gold I",
    market: "doge",
    topics: ["elon", "memecoins"],
    media: [
      {
        kind: "candles",
        alt: "DOGE/USD one-minute chart flat around 0.119, then a vertical green candle to 0.128, circled with the note the meme",
        seed: "doge-meme",
        pair: "DOGE/USD",
        interval: "1m",
        path: [0.1191, 0.1188, 0.1193, 0.1189, 0.1192, 0.1286, 0.1271],
        note: "the meme",
      },
    ],
  },
  {
    id: "wf1",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "wif down 30% from the highs and not a single holder has taken the hat off. respect honestly",
    timestamp: "32m ago",
    likes: 860,
    replies: 64,
    vouches: 150,
    defies: 53,
    kind: "text",
    rank: "Bronze III",
    topics: ["wif", "memecoins"],
    media: [{ kind: "meme", alt: "Cap emoji meme captioned WIF holders, the hat stays on", seed: "hat-stays-on", emoji: "🧢", top: "WIF holders", bottom: "The hat stays on" }],
  },
  {
    id: "g4",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "DOGE daily round was absolute chaos. GG to whoever took the other side of that one...",
    timestamp: "33m ago",
    likes: 9,
    replies: 1,
    vouches: 1,
    defies: 0,
    kind: "result",
    rank: "Gold I",
    call: {
      market: "doge",
      side: "SHORT",
      entryPrice: "0.1682",
      currentPrice: "0.1701",
      stop: 0.174,
      target: 0.162,
      outcome: { status: "lost", amount: 380 },
    },
  },
  {
    id: "m-macro1",
    author: "Lena",
    handle: "@lena_q",
    avatarInitial: "L",
    content: "Softer inflation print and the market priced in three cuts by spring within five minutes. I've seen this movie. The first cut is always the easy part.",
    timestamp: "34m ago",
    likes: 900,
    replies: 120,
    vouches: 160,
    defies: 40,
    kind: "text",
    rank: "Silver III",
    topics: ["macro"],
    media: [
      {
        kind: "headline",
        alt: "News article screenshot: Inflation cools again, and traders rush to price in faster rate cuts",
        outlet: "The Daily Candle",
        section: "Markets · Macro",
        headline: "Inflation cools again, and traders rush to price in faster rate cuts",
        dek: "Bitcoin and stocks jumped within minutes of the release as futures moved to price two more cuts before spring.",
        byline: "Dana Whitfield",
        time: "Oct 5, 2026 · 8:34 AM ET",
      },
    ],
  },
  {
    id: "n5",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "hot take: 1 minute pulse rounds teach u more than any $2k trading course. nothing humbles you faster than losing in public",
    timestamp: "35m ago",
    likes: 640,
    replies: 91,
    vouches: 27,
    defies: 4,
    kind: "text",
    rank: "Gold I",
  },
  {
    id: "a-ai1",
    author: "Lena",
    handle: "@lena_q",
    avatarInitial: "L",
    content: "Nvidia reports after the close and half of crypto is trading it like a BTC proxy. AI tokens move first, then everyone remembers most of them have no revenue.",
    timestamp: "36m ago",
    likes: 530,
    replies: 62,
    vouches: 45,
    defies: 8,
    kind: "text",
    rank: "Silver III",
    topics: ["nvidia", "ai"],
  },
  {
    id: "g9",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "fomc minutes in an hour. options desks pricing a violent move either way. size down anon",
    timestamp: "38m ago",
    likes: 58,
    replies: 15,
    vouches: 6,
    defies: 2,
    kind: "text",
    rank: "Silver I",
    flair: "followed",
    topics: ["macro"],
  },
  {
    id: "r4",
    author: "0xbagholder",
    handle: "@0xbagholder",
    avatarInitial: "0",
    content: "why does every coin i buy immediately go down 10%. genuinely asking. is it me",
    timestamp: "38m ago",
    likes: 340,
    replies: 96,
    vouches: 22,
    defies: 9,
    kind: "text",
    rank: "Bronze II",
    topics: ["memecoins"],
  },
  {
    id: "br1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "brett holding up better than most of base this week. blue frog outperforming green frog was not on my bingo card",
    timestamp: "39m ago",
    likes: 540,
    replies: 41,
    vouches: 66,
    defies: 28,
    kind: "text",
    rank: "Gold II",
    topics: ["brett", "memecoins"],
  },
  {
    id: "s-sol4",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "who market sold sol into a thin book?? wicked to 146.2, literally 10 cents above half the tl's stops, and bought back in 2 min. thank u for ur service",
    timestamp: "40m ago",
    likes: 640,
    replies: 77,
    vouches: 58,
    defies: 15,
    kind: "text",
    rank: "Bronze II",
    market: "sol",
    media: [
      {
        kind: "candles",
        alt: "SOL/USD one-minute chart around 150 with one long wick down to 146.2, circled with the note who did this",
        seed: "sol-wick",
        pair: "SOL/USD",
        interval: "1m",
        path: [149.8, 150.1, 149.6, 150.4, 150.0, 150.7, 151.0],
        spike: { at: 0.62, price: 146.2 },
        note: "who did this",
      },
    ],
  },
  {
    id: "n6",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "Another bridge drained overnight. Every cycle we relearn the same lesson... if you can't explain where the yield comes from, YOU are the yield.",
    timestamp: "41m ago",
    likes: 178,
    replies: 23,
    vouches: 40,
    defies: 7,
    kind: "text",
    rank: "Gold I",
    topics: ["defi"],
    media: [
      {
        kind: "headline",
        alt: "News article screenshot: Cross-chain bridge drained of $41 million in overnight exploit",
        outlet: "The Mempool",
        section: "Security",
        headline: "Cross-chain bridge drained of $41 million in overnight exploit",
        dek: "The team paused deposits and says a compromised signer key let the attacker mint unbacked tokens on two chains.",
        byline: "Theo Marsh",
        time: "Oct 5, 2026 · 6:12 AM ET",
      },
    ],
  },
  {
    id: "p-vitalik1",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "new vitalik post is a 40 min read on rollup security and ct already summarized it as \"eth good\". read the withdrawal windows part, thats the actual alpha",
    timestamp: "43m ago",
    likes: 980,
    replies: 76,
    vouches: 140,
    defies: 38,
    kind: "text",
    rank: "Silver I",
    topics: ["vitalik", "ethereum"],
  },
  {
    id: "hy1",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "HYPE is the only chart on my screen that hasn't needed a hopium thread this year. Fees buy the token back every day. No unlock calendar to babysit.",
    timestamp: "44m ago",
    likes: 1200,
    replies: 85,
    vouches: 170,
    defies: 64,
    kind: "text",
    rank: "Diamond II",
    topics: ["hype", "defi"],
    media: [
      {
        kind: "candles",
        alt: "HYPE/USD daily chart climbing from 24 to 41 and pressing through a dashed range-high line at 40",
        seed: "hype-grind",
        pair: "HYPE/USD",
        interval: "1D",
        path: [24.1, 27.3, 26.2, 30.8, 33.9, 32.7, 37.6, 41.2],
        level: { price: 40, label: "range high" },
      },
    ],
  },
  {
    id: "g5",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "does anyone know when 24h reading mode is actually coming out?? its been \"soon\" for like a month 😭",
    timestamp: "45m ago",
    likes: 27,
    replies: 8,
    vouches: 2,
    defies: 1,
    kind: "text",
    rank: "Silver II",
  },
  {
    id: "pp2",
    author: "Lena",
    handle: "@lena_q",
    avatarInitial: "L",
    content: "PEPE open interest at a yearly high while spot volume is flat. That's leverage, not demand. Be careful up here.",
    timestamp: "47m ago",
    likes: 380,
    replies: 52,
    vouches: 31,
    defies: 9,
    kind: "text",
    rank: "Silver III",
    topics: ["pepe"],
  },
  {
    id: "a-ai2",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "gave an ai agent my memecoin bag and told it to be responsable. heres how that went",
    timestamp: "48m ago",
    likes: 1900,
    replies: 133,
    vouches: 260,
    defies: 107,
    kind: "text",
    rank: "Bronze III",
    topics: ["ai", "memecoins"],
    media: [
      {
        kind: "chat",
        alt: "Chat with an AI trading agent that rotates a memecoin bag into three newer memecoins and then writes a haiku about conviction",
        title: "trading agent",
        subtitle: "AI agent · online",
        time: "Today 8:12 AM",
        messages: [
          { text: "manage my memecoin bag. be responsible.", me: true },
          { text: "Understood. I rotated your bag into three newer memecoins with stronger community energy." },
          { text: "that is the opposite of responsible", me: true },
          { text: "I also wrote you a haiku:\ngreen candles at dawn\nconviction is a feeling\nyour bags are heavy" },
        ],
      },
    ],
  },
  {
    id: "bk2",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "bonk burned another chunk of supply and the chart didnt even blink lmao. tokenomics are a vibe not a catalyst",
    timestamp: "50m ago",
    likes: 290,
    replies: 37,
    vouches: 22,
    defies: 3,
    kind: "text",
    rank: "Gold I",
    topics: ["bonk", "memecoins"],
  },
  {
    id: "b-br1",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "biggest etf issuer's btc fund took in more on red days than green days this week. the people buying this dip dont check the timeline",
    timestamp: "52m ago",
    likes: 1400,
    replies: 96,
    vouches: 180,
    defies: 72,
    kind: "text",
    rank: "Oracle",
    topics: ["blackrock", "bitcoin"],
  },
  {
    id: "ad1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "spent 0.4 eth in gas farming that airdrop all summer. checked eligibility this morning 🫠",
    timestamp: "55m ago",
    likes: 1100,
    replies: 88,
    vouches: 150,
    defies: 16,
    kind: "text",
    rank: "Gold II",
    topics: ["airdrops", "ethereum"],
    media: [{ kind: "meme", alt: "Parachute meme captioned airdrop season, 0 tokens", seed: "airdrop-zero", emoji: "🪂", top: "Airdrop season", bottom: "0 tokens" }],
  },
  {
    id: "hy2",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "a perp dex that buys back its own token with fees > every vc coin with a 4 year unlock. not close",
    timestamp: "57m ago",
    likes: 640,
    replies: 58,
    vouches: 90,
    defies: 36,
    kind: "text",
    rank: "Silver I",
    topics: ["hype", "defi"],
  },
  {
    id: "p-saylor2",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "Whatever you think of Saylor, a public company holding BTC as its treasury asset did more for adoption than a decade of conference panels.",
    timestamp: "58m ago",
    likes: 760,
    replies: 98,
    vouches: 64,
    defies: 15,
    kind: "text",
    rank: "Diamond II",
    topics: ["saylor", "bitcoin"],
  },
  {
    id: "g6",
    author: "OracleBot",
    handle: "@oraclebot",
    avatarInitial: "O",
    content: "New: resolved calls now show WON, LOST, or how close you got — right in the feed.",
    timestamp: "1h ago",
    likes: 5,
    replies: 0,
    kind: "promo",
  },
];

export const EXCLUSIVE_POSTS: Post[] = [
  {
    id: "e1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "watching for a btc pullback before the next pulse round. nfa obviously 🤫",
    timestamp: "4m ago",
    likes: 112,
    replies: 21,
    vouches: 14,
    defies: 15,
    kind: "call",
    rank: "Gold II",
    call: {
      market: "btc",
      side: "LONG",
      leverage: 10,
      entryPrice: "67,240",
      currentPrice: "68,451",
      stop: 66500,
      target: 69500,
      windowMin: 360,
      expiresIn: "5h 10m",
      copiedBy: 1900,
    },
  },
  {
    id: "e2",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "the read on eth vol in here is completely different from the public feed. high rank lobby hits different",
    timestamp: "17m ago",
    likes: 84,
    replies: 14,
    vouches: 5,
    defies: 1,
    kind: "result",
    rank: "Silver I",
    call: {
      market: "eth",
      side: "SHORT",
      leverage: 15,
      entryPrice: "3,398",
      currentPrice: "3,431",
      stop: 3450,
      target: 3300,
      outcome: { status: "lost", amount: 1200 },
    },
  },
  {
    id: "e3",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "ranked up to gold this week!! exclusive queue moves soooo much faster",
    timestamp: "42m ago",
    likes: 56,
    replies: 9,
    vouches: 3,
    defies: 1,
    kind: "text",
    rank: "Gold III",
  },
];
