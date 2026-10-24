// Profile shapes for /profile/[handle] (app/profile/[handle]/page.tsx) and
// your own /profile. Client-safe: no DB import. Every profile is a real
// account's — from Clerk + the `profiles` table (lib/profile.ts).
import type { MarketCall, Post, Reply } from "@/app/lib/posts";
import type { ProfileBanner } from "@/app/lib/profileEdit";

export type Profile = {
  handle: string;
  name: string;
  avatarInitial: string;
  rank: string;
  bio: string;
  joined: string;
  followers: number;
  following: number;
  // App-owned upload or provider photo; none = the gradient initial.
  imageUrl?: string;
  location?: string;
  website?: string;
  banner?: ProfileBanner;
};

// "@ren.eth" -> "/profile/ren.eth" when `account` says it's a real account's
// handle (saved posts, replies and reposts: their handles come from
// `profiles`, so the page exists). Undefined otherwise (house bots, accounts
// without a handle) so callers render plain text instead.
export function profileHref(handle: string, account = false): string | undefined {
  return account && handle ? `/profile/${encodeURIComponent(handle.slice(1))}` : undefined;
}

export type ProfileComment = { reply: Reply; post: Post };
export type ProfileTrade = { post: Post; call: MarketCall };
export type ProfileActivity = { omens: Post[]; comments: ProfileComment[]; trades: ProfileTrade[] };

// The profile Portfolio tab (app/profile/[handle]/ProfileView.tsx): a 24h
// session shaped like docs/portfolio.md (Base meme coins, spot or 1/2/3/5×
// leverage lots). No page fills it yet, so the tab shows its empty state.
export type PortfolioLot = {
  symbol: string;
  kind: "spot" | "leverage";
  side?: "long" | "short";
  leverage?: number;
  value: number;
  pnlPct: number;
};

export type ProfilePortfolio = { equity: number; pnlPct: number; endsIn: string; lots: PortfolioLot[] };
