// Mock user profiles for /profile/[handle] (app/profile/[handle]/page.tsx).
// Display-only, no backend — keyed by the same handle strings the feed mocks
// use, so feed authors link straight here. Portfolios live in
// mockPortfolios.ts so PostCard (a client component importing profileHref)
// never pulls them into the browser bundle.
import { EXCLUSIVE_POSTS, GLOBAL_POSTS, POST_REPLIES, type MarketCall, type Post, type Reply } from "@/app/lib/mockPosts";
import type { ProfileBanner } from "@/app/lib/profileEdit";

export type Profile = {
  handle: string;
  name: string;
  avatarInitial: string;
  // Matches the rank on this author's feed posts.
  rank: string;
  bio: string;
  joined: string;
  followers: number;
  following: number;
  // Own profile only (/profile, from Clerk + the `profiles` table). Mock
  // profiles use a gradient initial and have none of these.
  imageUrl?: string;
  location?: string;
  website?: string;
  banner?: ProfileBanner;
};

export const PROFILES: Profile[] = [
  { handle: "@vesper", name: "Vesper", avatarInitial: "V", rank: "Oracle", bio: "fading crowded trades since 2017. no paid group, no discord. dms closed.", joined: "Nov 2024", followers: 48200, following: 37 },
  { handle: "@juno_dx", name: "Juno", avatarInitial: "J", rank: "Diamond II", bio: "Ex-TradFi. I watch the basis so you don't have to. Spot volume or it didn't happen.", joined: "Jan 2025", followers: 12900, following: 88 },
  { handle: "@nova_trades", name: "Nova", avatarInitial: "N", rank: "Gold II", bio: "scalping btc one candle at a time ⚡ 10x is a lifestyle. nfa, obviously", joined: "Mar 2025", followers: 6420, following: 182 },
  { handle: "@zane_lfg", name: "Zane", avatarInitial: "Z", rank: "Gold I", bio: "calling the btc daily close every night until i'm wrong 🔥 lfg", joined: "Apr 2025", followers: 3110, following: 145 },
  { handle: "@marcus_calls", name: "Marcus", avatarInitial: "M", rank: "Gold I", bio: "professional dip buyer, amateur chart drawer. survived doge '21, i'll survive this", joined: "Feb 2025", followers: 2740, following: 301 },
  { handle: "@ren.eth", name: "Ren", avatarInitial: "R", rank: "Silver I", bio: "eth since 2017, terrible at selling. in a complicated relationship with leverage", joined: "Jun 2025", followers: 1240, following: 410 },
  { handle: "@priya_p", name: "Priya", avatarInitial: "P", rank: "Silver II", bio: "memes first, macro if i'm bored 🐕 still long doge, don't ask", joined: "Jul 2025", followers: 980, following: 512 },
  { handle: "@lena_q", name: "Lena", avatarInitial: "L", rank: "Silver III", bio: "i bid where you panic sell. patient until fomc week", joined: "May 2025", followers: 320, following: 190 },
  { handle: "@8bitkay", name: "8bit Kay", avatarInitial: "K", rank: "Bronze III", bio: "base season believer 🔵 long threads, short attention span. spot only since the 40x incident", joined: "Aug 2025", followers: 412, following: 266 },
  { handle: "@tobi.sol", name: "Tobi", avatarInitial: "T", rank: "Bronze II", bio: "came for sol, stayed for the pulse rounds. this is not financial advice, it's barely financial", joined: "Sep 2025", followers: 150, following: 220 },
];

export function getProfile(handle: string): Profile | undefined {
  return PROFILES.find((profile) => profile.handle === handle);
}

// "@ren.eth" -> "/profile/ren.eth". Undefined for handles with no profile
// (bots, unknown reply authors) so callers render plain text instead.
export function profileHref(handle: string): string | undefined {
  return getProfile(handle) ? `/profile/${handle.slice(1)}` : undefined;
}

export type ProfileComment = { reply: Reply; post: Post };
export type ProfileTrade = { post: Post; call: MarketCall };
export type ProfileActivity = { omens: Post[]; comments: ProfileComment[]; trades: ProfileTrade[] };

const ALL_POSTS = [...GLOBAL_POSTS, ...EXCLUSIVE_POSTS];

export function profileActivity(profile: Profile): ProfileActivity {
  // Feed posts carry their own hand-typed rank; show the profile's so the
  // page never disagrees with its own header.
  const omens = ALL_POSTS.filter((post) => post.handle === profile.handle).map((post) => ({ ...post, rank: profile.rank }));
  const comments = Object.entries(POST_REPLIES).flatMap(([postId, replies]) => {
    const post = ALL_POSTS.find((p) => p.id === postId);
    if (!post) return [];
    return replies.filter((reply) => reply.handle === profile.handle).map((reply) => ({ reply, post }));
  });
  const trades = omens.flatMap((post) => (post.call ? [{ post, call: post.call }] : []));
  return { omens, comments, trades };
}
