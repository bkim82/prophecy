import { storedProfileFor } from "@/lib/profile";
import { getViewerProfile, type Viewer } from "@/lib/viewer";

/**
 * Who a new post or reply is by, derived server-side (never read from the
 * body): `profiles.displayName`, else the provider name, else "Prophecy
 * trader"; the handle only from `profiles`, where it's unique.
 */
export async function authorFor(viewer: Viewer): Promise<{ authorName: string; authorHandle: string | null }> {
  const [stored, provider] = await Promise.all([storedProfileFor(viewer.userId), getViewerProfile(viewer)]);
  // getViewerProfile falls back to "You" for the viewer's own screens, which
  // would read wrong to everyone else.
  const providerName = provider?.displayName && provider.displayName !== "You" ? provider.displayName : null;
  return { authorName: stored?.displayName ?? providerName ?? "Prophecy trader", authorHandle: stored?.handle ?? null };
}
