// Mock feed content for the Global/Exclusive Twitter-style pages. No backend,
// no persistence, no posting flow yet — see docs/feeds.md.
//
// Author/handle here are plain hardcoded strings. Real posts should use Clerk
// identity (currentUser()/useUser()) for authorship — Clerk gives a
// persistent, visible name/handle, unlike the anonymous per-browser id from
// app/lib/playerId.ts, which is only meant for anonymous matchmaking.
// Trade-off for a future posting pass: signed-out visitors could view feeds
// but would need to sign in to post.
export type Market = "btc" | "eth" | "doge";
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

// Placeholder art standing in for real image uploads (no asset pipeline
// yet) — "chart" draws a big sparkline from `spark`, "meme" is a gradient
// tile (keyed off `seed`, same trick as the avatar gradient) with a large
// emoji. Purely decorative, no real chart/photo data behind either.
export type PostImage =
  | { kind: "chart"; seed: string; spark: number[] }
  | { kind: "meme"; seed: string; emoji: string };

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
  // Display-only count beside the repost toggle; nothing increments it.
  reposts?: number;
  kind: PostKind;
  rank?: string;
  call?: MarketCall;
  image?: PostImage;
  streakStat?: string;
  // Community tag for the feed's market pills (app/FeedSwitcher.tsx). Only
  // needed on posts without a `call` — a call post's own `call.market`
  // already implies its community.
  market?: Market;
  flair?: PostFlair;
  clash?: Clash;
};

// Platform-wide count beside "Live Calls" in the feed rail — a hardcoded
// mock, not derived from the posts below.
export const LIVE_CALL_COUNT = 214;

// Drives the "Following" feed filter (app/FeedSwitcher.tsx) — not a real
// social graph, just a hardcoded handle allowlist for the mock.
export const FOLLOWED_HANDLES = ["@nova_trades", "@ren.eth", "@zane_lfg"];

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
    { id: "gs1-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "dormant coins moving is usually custody shuffling, not selling", timestamp: "2m ago", likes: 38 },
    { id: "gs1-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "imagine finding that hard drive in a drawer", timestamp: "1m ago", likes: 21 },
  ],
  "t-near": [
    { id: "t-near-r1", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "add margin or say goodbye, those are the options", timestamp: "6m ago", likes: 14 },
    { id: "t-near-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "the 12 people tailing this are brave", timestamp: "5m ago", likes: 30 },
  ],
  n1: [
    { id: "n1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "the 2pm candle is the only honest part of the day", timestamp: "5m ago", likes: 11 },
    { id: "n1-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "already drafting my priced in thread tbh", timestamp: "4m ago", likes: 19 },
  ],
  n2: [
    { id: "n2-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "maintenance: when the order book gets too honest", timestamp: "11m ago", likes: 42 },
    { id: "n2-r2", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "keep some size on two venues, learned that one the hard way", timestamp: "9m ago", likes: 27 },
  ],
  n4: [
    { id: "n4-r1", author: "Juno", handle: "@juno_dx", avatarInitial: "J", content: "agreed, and most of it is sitting on exchanges, not in DeFi", timestamp: "20m ago", likes: 96 },
    { id: "n4-r2", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "the timeline will notice right after the move", timestamp: "18m ago", likes: 51 },
    { id: "n4-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "saving this for when someone asks where the bid came from", timestamp: "15m ago", likes: 33 },
  ],
  g1: [
    { id: "g1-r1", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "LFG 🔥 called it", timestamp: "1m ago", likes: 4 },
    { id: "g1-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "wish I sized up on this one", timestamp: "1m ago", likes: 2 },
    { id: "g1-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "6 for 6 this week, insane", timestamp: "45s ago", likes: 1 },
  ],
  g2: [
    { id: "g2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "hang in there, still time on the clock", timestamp: "3m ago", likes: 2 },
    { id: "g2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "25x on ETH rn is wild honestly", timestamp: "2m ago", likes: 1 },
  ],
  g3: [
    { id: "g3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "welcome to the club 🏆", timestamp: "8m ago", likes: 5 },
    { id: "g3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "gg! who'd you face in the arena", timestamp: "7m ago", likes: 1 },
    { id: "g3-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "first of many", timestamp: "5m ago", likes: 3 },
  ],
  g7: [
    { id: "g7-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "dip buyers eating good fr", timestamp: "10m ago", likes: 9 },
    { id: "g7-r2", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "reclaim looks clean on the chart", timestamp: "9m ago", likes: 4 },
    { id: "g7-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "loaded more at 66.8", timestamp: "6m ago", likes: 2 },
  ],
  g8: [
    { id: "g8-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "lmaooo felt this", timestamp: "16m ago", likes: 21 },
    { id: "g8-r2", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "doge gang stays coping", timestamp: "14m ago", likes: 33 },
    { id: "g8-r3", author: "Zane", handle: "@zane_lfg", avatarInitial: "Z", content: "this is a mood", timestamp: "9m ago", likes: 12 },
  ],
  g4: [{ id: "g4-r1", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "so close, brutal", timestamp: "22m ago", likes: 1 }],
  g9: [
    { id: "g9-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "sizing down, thanks for the heads up", timestamp: "28m ago", likes: 6 },
    { id: "g9-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "violent move either way for sure", timestamp: "25m ago", likes: 3 },
  ],
  g5: [
    { id: "g5-r1", author: "8bit Kay", handle: "@8bitkay", avatarInitial: "K", content: "same, been checking every patch note", timestamp: "30m ago", likes: 3 },
    { id: "g5-r2", author: "ArenaBot", handle: "@arenabot", avatarInitial: "A", content: "still cooking, no ETA yet", timestamp: "20m ago", likes: 8 },
  ],
  "g-oracle1": [
    { id: "g-oracle1-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "tailing this, stop's tight enough to size", timestamp: "3m ago", likes: 48 },
    { id: "g-oracle1-r2", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "that 68.5k wall has been sitting there all morning", timestamp: "2m ago", likes: 31 },
    { id: "g-oracle1-r3", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "18k people on one side is either genius or the top", timestamp: "1m ago", likes: 22 },
  ],
  "g-diamond1": [
    { id: "g-diamond1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "spot volume is the tell, agreed", timestamp: "9m ago", likes: 14 },
    { id: "g-diamond1-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "copied at 3,410 lfg", timestamp: "6m ago", likes: 9 },
  ],
  e1: [
    { id: "e1-r1", author: "Ren", handle: "@ren.eth", avatarInitial: "R", content: "exclusive feed reads different fr", timestamp: "3m ago", likes: 6 },
    { id: "e1-r2", author: "Lena", handle: "@lena_q", avatarInitial: "L", content: "watching for the same pullback", timestamp: "2m ago", likes: 2 },
  ],
  e2: [
    { id: "e2-r1", author: "Nova", handle: "@nova_trades", avatarInitial: "N", content: "volatility got you this time", timestamp: "14m ago", likes: 3 },
    { id: "e2-r2", author: "Tobi", handle: "@tobi.sol", avatarInitial: "T", content: "high-rank lobby is no joke", timestamp: "11m ago", likes: 5 },
  ],
  e3: [
    { id: "e3-r1", author: "Marcus", handle: "@marcus_calls", avatarInitial: "M", content: "congrats, queue's way faster up here", timestamp: "35m ago", likes: 4 },
    { id: "e3-r2", author: "Priya", handle: "@priya_p", avatarInitial: "P", content: "gg, see you in exclusive", timestamp: "30m ago", likes: 2 },
  ],
};

export const GLOBAL_POSTS: Post[] = [
  {
    id: "g-oracle1",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "Funding flipped hot and the 68.5k wall hasn't moved in six hours. Fading this pump — stop above 69.2k.",
    timestamp: "2m ago",
    likes: 1284,
    replies: 216,
    reposts: 88,
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
    content: "A wallet that's been asleep since 2014 just moved its whole BTC stack. Either an early miner woke up or somebody found a very old hard drive. Timeline is already calling the top.",
    timestamp: "3m ago",
    likes: 356,
    replies: 48,
    reposts: 72,
    kind: "text",
    rank: "Gold I",
    flair: "engaging",
    market: "btc",
  },
  {
    id: "g1",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "Called BTC up 3 rounds in a row. Cast is printing today.",
    timestamp: "5m ago",
    likes: 41,
    replies: 6,
    reposts: 3,
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
    id: "gs2",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "Heard from two different people that a big exchange is listing a dog coin next week. So it's either the worst-kept secret in crypto or nobody actually knows anything.",
    timestamp: "7m ago",
    likes: 188,
    replies: 39,
    reposts: 21,
    kind: "text",
    rank: "Silver II",
    market: "doge",
  },
  {
    id: "t-near",
    author: "Tobi",
    handle: "@tobi.sol",
    avatarInitial: "T",
    content: "Went 50x on ETH because the chart 'looked ready.' The chart was not ready. If this candle closes green I'm framing it.",
    timestamp: "8m ago",
    likes: 77,
    replies: 24,
    reposts: 6,
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
    content: "Rate decision tomorrow and everyone's pretending they aren't positioned for a cut. Same script every meeting: chop all morning, one candle at 2pm, then a wave of 'it was priced in' threads.",
    timestamp: "9m ago",
    likes: 88,
    replies: 14,
    reposts: 9,
    kind: "text",
    rank: "Silver III",
  },
  {
    id: "g-diamond1",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "ETH reclaimed the weekly open on real spot volume. Riding it to 3.5k, invalidation under 3,380.",
    timestamp: "10m ago",
    likes: 486,
    replies: 64,
    reposts: 37,
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
    content: "Watching a big account quietly delete last week's 'BTC to 50k' call. The internet remembers. Screenshots are forever.",
    timestamp: "11m ago",
    likes: 97,
    replies: 16,
    reposts: 12,
    kind: "text",
    rank: "Silver I",
    flair: "followed",
  },
  {
    id: "g8",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "me explaining to my portfolio why I'm still long doge",
    timestamp: "13m ago",
    likes: 302,
    replies: 41,
    reposts: 140,
    kind: "text",
    rank: "Silver II",
    flair: "engaging",
    image: { kind: "meme", seed: "doge-cope", emoji: "🐕" },
    market: "doge",
  },
  {
    id: "t-liq",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: "Liquidated on a 30-second wick. 40x was a choice. Back to spot like a responsible adult.",
    timestamp: "14m ago",
    likes: 129,
    replies: 27,
    reposts: 14,
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
    content: "Another big exchange went down for 'scheduled maintenance' right as BTC ripped 3%. Funny how maintenance never lands on a quiet Sunday.",
    timestamp: "15m ago",
    likes: 412,
    replies: 57,
    reposts: 61,
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
    content: "Called BTC's close again before the 11:59pm bell. Streak's still alive.",
    timestamp: "16m ago",
    likes: 76,
    replies: 9,
    reposts: 11,
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
    content: "Pulse leverage on ETH is nasty right now. Down 0.4 and I'm sweating.",
    timestamp: "17m ago",
    likes: 18,
    replies: 3,
    reposts: 4,
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
    id: "n4",
    author: "Vesper",
    handle: "@vesper",
    avatarInitial: "V",
    content: "Stablecoin supply just hit a new high while the timeline argues about memecoins. Dry powder doesn't sit on the sidelines forever. That's the chart I'm watching this week, not ETH/BTC.",
    timestamp: "19m ago",
    likes: 2140,
    replies: 188,
    reposts: 304,
    kind: "text",
    rank: "Oracle",
    flair: "followed",
  },
  {
    id: "g3",
    author: "8bit Kay",
    handle: "@8bitkay",
    avatarInitial: "K",
    content: `Base Season feels like the moment the whole onchain world remembers that the best ecosystems are not built by shouting the loudest, but by giving people a reason to keep showing up. What makes Base interesting to me is the mix of serious builders, weird little experiments, consumer apps, and culture that can all exist in the same block space without everything needing to look like another copy-pasted financial dashboard. The low-friction onboarding matters, but the bigger story is that Base keeps making crypto feel less like a place you visit for one trade and more like an internet neighborhood where identities, communities, games, art, and money can overlap. That is the part of the season I am watching: not just which token gets the biggest candle, but which projects earn actual habits from their users.

My take is that Base Season will reward consistency over pure hype. The teams that last will be the ones turning attention into products people use on an ordinary Tuesday, while the communities that win will be the ones making newcomers feel like participants instead of exit liquidity. There will absolutely be noise, recycled narratives, and launches that sprint for a week before disappearing, but that is normal when a network becomes a cultural magnet. I would rather follow the builders shipping through the boring stretches, the creators making the ecosystem feel alive, and the apps that quietly remove three steps from something everyone already wants to do. If Base can keep that balance between speed, experimentation, and genuine usability, this season could be less of a speculative moment and more of a lasting reset for what an accessible onchain ecosystem looks like.`,
    timestamp: "21m ago",
    likes: 63,
    replies: 12,
    reposts: 9,
    kind: "text",
    rank: "Bronze III",
    flair: "forYou",
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
    content: "DOGE never made it to 0.132 before the window closed. Thesis was right, clock was wrong. That's what I'm telling myself.",
    timestamp: "23m ago",
    likes: 64,
    replies: 11,
    reposts: 3,
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
  },
  {
    id: "gs4",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "Is it just me or does every new L2 launch come with a points program, a mascot, and a Discord that's 90% airdrop farmers?",
    timestamp: "24m ago",
    likes: 274,
    replies: 33,
    reposts: 19,
    kind: "text",
    rank: "Gold I",
  },
  {
    id: "g7",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "BTC reclaiming 68k like it's nothing. Dip buyers eating good this week.",
    timestamp: "26m ago",
    likes: 134,
    replies: 22,
    reposts: 12,
    kind: "text",
    rank: "Gold I",
    image: { kind: "chart", seed: "btc-reclaim", spark: [65.1, 65.6, 65.3, 66.2, 67.0, 66.8, 67.6, 68.4] },
    market: "btc",
  },
  {
    id: "n3",
    author: "Juno",
    handle: "@juno_dx",
    avatarInitial: "J",
    content: "Daily ETF flow numbers are the most overrated stat in crypto. Net inflows tell you who already bought, not who's about to sell. Watch the futures basis if you want the real read on positioning.",
    timestamp: "28m ago",
    likes: 231,
    replies: 29,
    reposts: 18,
    kind: "text",
    rank: "Diamond II",
    market: "btc",
  },
  {
    id: "gs5",
    author: "Nova",
    handle: "@nova_trades",
    avatarInitial: "N",
    content: "Real question for the timeline: what's your rule for taking profit? Mine is sell a third at 2x and pretend the rest is already zero.",
    timestamp: "30m ago",
    likes: 143,
    replies: 61,
    reposts: 8,
    kind: "text",
    rank: "Gold II",
  },
  {
    id: "g4",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "DOGE daily coin round was chaos. GG to whoever took the other side of that.",
    timestamp: "33m ago",
    likes: 9,
    replies: 1,
    reposts: 1,
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
    id: "n5",
    author: "Zane",
    handle: "@zane_lfg",
    avatarInitial: "Z",
    content: "Hot take: 1-minute Pulse rounds teach you more than any trading course. Nothing humbles you faster than losing in public.",
    timestamp: "35m ago",
    likes: 640,
    replies: 91,
    reposts: 27,
    kind: "text",
    rank: "Gold I",
  },
  {
    id: "g9",
    author: "Ren",
    handle: "@ren.eth",
    avatarInitial: "R",
    content: "FOMC minutes drop in an hour. Options desks are pricing in a violent move either direction — size down.",
    timestamp: "38m ago",
    likes: 58,
    replies: 15,
    reposts: 6,
    kind: "text",
    rank: "Silver I",
    flair: "followed",
  },
  {
    id: "n6",
    author: "Marcus",
    handle: "@marcus_calls",
    avatarInitial: "M",
    content: "Another bridge got drained overnight. Every cycle we relearn the same lesson: if you can't explain where the yield comes from, you are the yield.",
    timestamp: "41m ago",
    likes: 178,
    replies: 23,
    reposts: 40,
    kind: "text",
    rank: "Gold I",
  },
  {
    id: "g5",
    author: "Priya",
    handle: "@priya_p",
    avatarInitial: "P",
    content: "Anyone else notice the 24h Reading mode is still \"soon\"? Been waiting on this one.",
    timestamp: "45m ago",
    likes: 27,
    replies: 8,
    reposts: 2,
    kind: "text",
    rank: "Silver II",
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
    content: "Exclusive alpha: watching for a BTC pullback before the next Pulse round. Not financial advice, obviously.",
    timestamp: "4m ago",
    likes: 112,
    replies: 21,
    reposts: 14,
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
    content: "High-rank lobby only — the read on ETH volatility here is completely different from the public feed.",
    timestamp: "17m ago",
    likes: 84,
    replies: 14,
    reposts: 5,
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
    content: "Ranked up to Gold this week. The exclusive queue moves so much faster.",
    timestamp: "42m ago",
    likes: 56,
    replies: 9,
    reposts: 3,
    kind: "text",
    rank: "Gold III",
  },
];
