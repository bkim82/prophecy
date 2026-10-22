import { GLOBAL_POSTS } from "@/app/lib/mockPosts";
import { PROFILES } from "@/app/lib/mockProfiles";
import { VIEWER_RANK } from "@/app/lib/rank";
import type { SearchResults } from "@/app/SidebarSearch";
import { searchProfiles } from "@/lib/profile";
import { providerImagesFor } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const LIMIT = 5;

/**
 * GET ?q= → the sidebar search (app/SidebarSearch.tsx): people (real accounts
 * with a handle, with their photo when they have one, then mock traders) by
 * handle or name, and Global feed posts by text, author or handle. A leading
 * "@" is ignored.
 */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50);
  if (!query) return Response.json({ users: [], posts: [] } satisfies SearchResults);
  const needle = query.toLowerCase();
  const has = (...fields: string[]) => fields.some((field) => field.toLowerCase().includes(needle));

  const real = await searchProfiles(query, LIMIT).catch(() => []);
  // Same precedence as their profile page: app-owned upload, then provider photo.
  const photos = await providerImagesFor(real.filter((account) => !account.hasAvatarImage).map((account) => account.userId));
  const users = [
    ...real.map((account) => ({
      handle: `@${account.handle}`,
      name: account.displayName ?? account.handle,
      rank: VIEWER_RANK,
      imageUrl: account.hasAvatarImage
        ? `/api/profile/avatar?handle=${encodeURIComponent(account.handle)}&v=${account.updatedAt.getTime()}`
        : photos.get(account.userId),
    })),
    ...PROFILES.filter((profile) => has(profile.handle, profile.name)).map(({ handle, name, rank }) => ({ handle, name, rank })),
  ].slice(0, LIMIT);
  const posts = GLOBAL_POSTS.filter((post) => post.kind !== "promo" && has(post.content, post.author, post.handle))
    .slice(0, LIMIT)
    .map(({ id, author, handle, content, timestamp }) => ({ id, author, handle, content, timestamp }));

  return Response.json({ users, posts } satisfies SearchResults);
}
