import "server-only";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { profiles, users } from "@/db/schema";
import { APP_SESSION_COOKIE, appSessionViewer } from "@/lib/appSession";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";

export type Viewer = {
  userId: string;
  smartAccountAddress: string | null;
};

export type ViewerProfile = {
  createdAt: Date;
  displayName: string;
  hasImage: boolean;
  imageUrl: string | null;
};

/**
 * The only server-side identity adapter used by application code.
 *
 * Clerk remains the default during the credential-gated transition. Enabling
 * embedded-wallet auth switches this adapter to the Prophecy app session and
 * fails closed; it never falls back to a Clerk identity in that mode.
 */
export async function getViewer(): Promise<Viewer | null> {
  if (embeddedWalletAuthEnabled()) {
    const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;
    return token ? appSessionViewer(token) : null;
  }

  const { userId } = await auth();
  return userId ? { userId, smartAccountAddress: null } : null;
}

/** Temporary bridge for provider-owned display name and account creation date. */
export async function getViewerProfile(viewer: Viewer): Promise<ViewerProfile | null> {
  if (embeddedWalletAuthEnabled()) {
    const [row] = await getDb()
      .select({ createdAt: users.createdAt, displayName: profiles.displayName })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, viewer.userId));
    if (!row) return null;
    return {
      createdAt: row.createdAt,
      displayName: row.displayName ?? "You",
      hasImage: false,
      imageUrl: null,
    };
  }

  const user = await currentUser();
  if (!user || user.id !== viewer.userId) return null;

  return {
    createdAt: new Date(user.createdAt),
    displayName: user.fullName ?? user.username ?? "You",
    hasImage: user.hasImage,
    imageUrl: user.imageUrl,
  };
}

// Per-instance cache for providerImagesFor, so search-as-you-type doesn't hit
// the provider on every keystroke. null = looked up, no photo.
const PROVIDER_IMAGE_TTL_MS = 5 * 60_000;
const providerImageCache = new Map<string, { url: string | null; at: number }>();

/**
 * Temporary bridge for other accounts' provider-owned photos (Clerk), for
 * public profiles and search: user id → photo URL, one request for up to 100
 * uncached ids. Leaves out anyone without a photo; empty with embedded auth
 * (photos are app-owned then) or when the provider can't be reached.
 */
export async function providerImagesFor(userIds: string[]): Promise<Map<string, string>> {
  if (embeddedWalletAuthEnabled() || userIds.length === 0) return new Map();
  const now = Date.now();
  const fresh = (id: string) => (providerImageCache.get(id)?.at ?? -Infinity) > now - PROVIDER_IMAGE_TTL_MS;
  const missing = userIds.filter((id) => !fresh(id)).slice(0, 100);
  if (missing.length > 0) {
    try {
      const { data } = await (await clerkClient()).users.getUserList({ userId: missing, limit: 100 });
      const urls = new Map(data.map((user) => [user.id, user.hasImage ? user.imageUrl : null]));
      if (providerImageCache.size > 5000) providerImageCache.clear();
      for (const id of missing) providerImageCache.set(id, { url: urls.get(id) ?? null, at: now });
    } catch {
      // Unreachable provider: show initials now, retry on the next lookup.
    }
  }
  return new Map(userIds.flatMap((id) => {
    const url = providerImageCache.get(id)?.url;
    return url ? [[id, url] as const] : [];
  }));
}
