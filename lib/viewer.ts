import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
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
