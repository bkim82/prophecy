import { rankForHandle } from "@/app/lib/rank";
import type { SearchResults } from "@/app/SidebarSearch";
import { blockedIdsFor } from "@/lib/blocks";
import { searchPosts } from "@/lib/posts";
import { searchProfiles } from "@/lib/profile";
import { getViewer, providerImagesFor } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const LIMIT = 5;

/**
 * GET ?q= → the sidebar search (app/SidebarSearch.tsx): people (accounts with
 * a handle, with their photo when they have one) by handle or name, and saved
 * posts by text, author or handle — none by anyone with a block either way
 * with the viewer. A leading "@" is ignored. `&people=1` (beta mode's friend
 * finder, app/FriendSearch.tsx) skips the posts.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50);
  if (!query) return Response.json({ users: [], posts: [] } satisfies SearchResults);

  const [accounts, posts] = await Promise.all([
    searchProfiles(query, LIMIT).catch(() => []),
    params.get("people") === "1" ? [] : visiblePosts(query),
  ]);
  // Same precedence as their profile page: app-owned upload, then provider photo.
  const photos = await providerImagesFor(accounts.filter((account) => !account.hasAvatarImage).map((account) => account.userId));
  const users = accounts.map((account) => ({
    handle: `@${account.handle}`,
    name: account.displayName ?? account.handle,
    rank: rankForHandle(account.handle),
    imageUrl: account.hasAvatarImage
      ? `/api/profile/avatar?handle=${encodeURIComponent(account.handle)}&v=${account.updatedAt.getTime()}`
      : photos.get(account.userId),
  }));

  return Response.json({ users, posts } satisfies SearchResults);
}

async function visiblePosts(query: string) {
  const viewerId = (await getViewer())?.userId;
  // Before db/blocks.sql is applied there's nothing to leave out.
  const blocked = viewerId ? await blockedIdsFor(viewerId).catch(() => new Set<string>()) : new Set<string>();
  return searchPosts(query, LIMIT, blocked).catch(() => []);
}
