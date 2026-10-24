// Feed shapes for the Global/Exclusive Twitter-style pages. Client-safe: no
// DB import. Every post and reply shown is one a real account wrote — saved
// in Postgres and read through lib/posts.ts / lib/engagement.ts; see
// docs/feeds.md and docs/posts.md.
//
// Saved posts are always `kind: "text"` (with an optional trade, photos, GIF
// or poll). The other kinds, `MarketCall` and the screenshot `PostImage`
// kinds have no saved form yet: PostCard / PostMedia can still draw them,
// but nothing produces them.
import type { GifId } from "@/app/lib/gifs";
import type { TopicId } from "@/app/lib/topics";
import type { TradeReceipt } from "@/app/lib/trades";
import type { Reshare, ReshareKind } from "@/app/PostShare";

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
  // Shown as "N tailing" under the Copy button (pending calls only). The
  // button copies nothing and nothing increments this.
  copiedBy?: number;
};

// Media under a post, drawn by app/PostMedia.tsx. Saved posts only ever carry
// "photo" or "gif"; the rest are HTML/SVG stand-ins for the screenshots
// people paste into posts on X, with no saved form:
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
// - "photo": a real image you attached in the composer (`src` is a blob: URL
//   that lives as long as the tab). "gif": one of the built-in reaction GIFs
//   (app/lib/gifs.ts), drawn and animated in HTML/CSS like the rest.
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
  | { kind: "photo"; src: string; width: number; height: number }
  | { kind: "gif"; gif: GifId }
);

// A poll written in the composer: 2–4 choices. On a saved post the counts,
// your vote and whether it has ended come from `poll_votes` and votes go to
// POST /api/posts/[id]/vote; without `counts` voting is local, like clash
// votes (app/PostPoll.tsx).
export type Poll = { choices: string[]; endsIn: string; counts?: number[]; yourVote?: number | null; closed?: boolean };

// Every post renders through PostCard, which branches on `kind`:
// "text" = plain take, "call"/"result" = market-call hero (pending vs
// resolved), "streak" = compact highlight banner, "promo" = quiet system
// line with no avatar/actions, "clash" = two opposing calls you can side with.
// Saved posts are always "text" (see the top of this file).
export type PostKind = "text" | "call" | "result" | "streak" | "promo" | "clash";

// Omen Clash: two players called opposite sides of the same print. `votes` is
// the crowd siding with each; voting in the UI adds one local vote and
// settles nothing.
export type ClashSide = { name: string; handle: string; direction: "up" | "down"; target: string; votes: number };
export type Clash = { market: Market; deadline: string; sides: [ClashSide, ClashSide] };

// Short tag at the right of a post's meta row (app/PostCard.tsx FLAIRS). No
// engagement or recommendation signal sets it yet.
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
  // Saved repost counts (lib/engagement.ts withEngagement), summed on the
  // Repost button and listed per kind in its menu (app/RepostMenu.tsx). All
  // three are reposts to your followers: plain, Vouch = one you back, Defy =
  // one you're against.
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
  // Interest topics picked in the composer (companies, people, themes, extra
  // coins) for the For You covers and topic chips. The market's coin is added on top.
  topics?: TopicId[];
  flair?: PostFlair;
  clash?: Clash;
  // One of your own trades, attached in the composer (app/compose) and
  // rendered by app/TradeCard.tsx. A snapshot from when you posted.
  trade?: TradeReceipt;
  // A saved post's trade ref that no longer resolves to its author's own
  // trade (lib/trades.ts tradeReceiptsFor) — shown as "Trade unavailable".
  tradeUnavailable?: boolean;
  poll?: Poll;
  // Stored in `posts` (lib/posts.ts). Every post the feeds show is.
  saved?: boolean;
  // Written by the viewer (composer posts): deletable from the ⋯ menu,
  // and it can be reposted but not vouched for or defied.
  mine?: boolean;
  // The viewer's saved engagement (lib/engagement.ts withEngagement): they
  // liked it (already counted in `likes`), and their own repost (counted in
  // `reposts`/`vouches`/`defies`).
  liked?: boolean;
  yourReshare?: Reshare;
  // A saved post whose author has a block either way with the viewer
  // (lib/blocks.ts, set by withEngagement): no replying or reposting.
  blocked?: boolean;
};

// A repost someone you follow made, as it lands in your feed: the original
// post under "Nova vouched for this omen" / "Zane defied this omen", from
// lib/engagement.ts followedReshares.
export type Share = {
  id: string;
  kind: ReshareKind;
  postId: string;
  name: string;
  handle: string;
  timestamp: string;
  // The sharer's own words, if any.
  text?: string;
  // A real account's saved repost (lib/engagement.ts followedReshares), so its
  // handle always has a profile page.
  saved?: boolean;
};

export type Reply = {
  id: string;
  author: string;
  handle: string;
  avatarInitial: string;
  content: string;
  timestamp: string;
  likes: number;
  // The viewer liked it (saved, already counted in `likes`).
  liked?: boolean;
  // A saved reply (lib/engagement.ts): its author is a real account; `mine`
  // = the viewer wrote it (they can edit or delete it); `edited` once changed.
  saved?: boolean;
  mine?: boolean;
  edited?: boolean;
};
