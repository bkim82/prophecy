import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles, users } from "@/db/schema";
import { rankForHandle } from "@/app/lib/rank";
import { embeddedWalletAuthEnabled } from "@/lib/embeddedWalletFeature";

// Reads/writes for the `profiles` table (db/schema.ts). Validation lives in
// app/profile/actions.ts; this layer only stores what it's handed.

export type ProfileFields = {
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
};

// Everything the page needs except image bytes, which stay in the table until
// their owner-only routes ask for them.
export type StoredProfile = ProfileFields & {
  bannerPreset: string | null;
  hasAvatarImage: boolean;
  hasBannerImage: boolean;
  pinnedMatches: string[];
  updatedAt: Date;
};

export async function storedProfileFor(userId: string): Promise<StoredProfile | null> {
  const [row] = await getDb()
    .select({
      displayName: profiles.displayName,
      handle: profiles.handle,
      bio: profiles.bio,
      location: profiles.location,
      website: profiles.website,
      bannerPreset: profiles.bannerPreset,
      hasAvatarImage: embeddedWalletAuthEnabled()
        ? sql<boolean>`${profiles.avatarImage} IS NOT NULL`
        : sql<boolean>`false`,
      hasBannerImage: sql<boolean>`${profiles.bannerImage} IS NOT NULL`,
      pinnedMatches: profiles.pinnedMatches,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return row ? { ...row, pinnedMatches: row.pinnedMatches ?? [] } : null;
}

/** Replaces the highlight-reel pins. Leaves `updatedAt` alone — it versions the banner URL. */
export async function savePinnedMatches(userId: string, ids: string[]): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({ userId, pinnedMatches: ids })
    .onConflictDoUpdate({ target: profiles.userId, set: { pinnedMatches: ids } });
}

/** Active Base smart account of the user holding `handle` (stored form), or null. */
export async function walletAddressForHandle(handle: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ address: users.smartAccountAddress })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(profiles.handle, handle), eq(users.walletStatus, "active"), eq(users.walletChainId, 8453)));
  return row?.address?.toLowerCase() ?? null;
}

// A real account's public profile (/profile/[handle]). Uploaded images are
// served by GET /api/profile/avatar|banner?handle=, versioned by `updatedAt`.
export type PublicProfile = ProfileFields & {
  userId: string;
  handle: string;
  bannerPreset: string | null;
  hasAvatarImage: boolean;
  hasBannerImage: boolean;
  updatedAt: Date;
  joined: Date;
};

/** The account holding `handle` (stored form: lowercase, no "@"), or null. */
export async function publicProfileFor(handle: string): Promise<PublicProfile | null> {
  const [row] = await getDb()
    .select({
      userId: profiles.userId,
      displayName: profiles.displayName,
      bio: profiles.bio,
      location: profiles.location,
      website: profiles.website,
      bannerPreset: profiles.bannerPreset,
      hasAvatarImage: embeddedWalletAuthEnabled()
        ? sql<boolean>`${profiles.avatarImage} IS NOT NULL`
        : sql<boolean>`false`,
      hasBannerImage: sql<boolean>`${profiles.bannerImage} IS NOT NULL`,
      createdAt: users.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.handle, handle));
  if (!row) return null;
  const { createdAt, ...fields } = row;
  return { ...fields, handle, joined: createdAt ?? fields.updatedAt };
}

export type ProfileMatch = { userId: string; handle: string; displayName: string | null; hasAvatarImage: boolean; updatedAt: Date };

/** Accounts with a handle whose handle or name contains `query` (any case); handle-prefix matches first. */
export async function searchProfiles(query: string, limit: number): Promise<ProfileMatch[]> {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
  const rows = await getDb()
    .select({
      userId: profiles.userId,
      handle: profiles.handle,
      displayName: profiles.displayName,
      hasAvatarImage: embeddedWalletAuthEnabled()
        ? sql<boolean>`${profiles.avatarImage} IS NOT NULL`
        : sql<boolean>`false`,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(and(isNotNull(profiles.handle), or(ilike(profiles.handle, `%${escaped}%`), ilike(profiles.displayName, `%${escaped}%`))))
    .orderBy(desc(ilike(profiles.handle, `${escaped}%`)), profiles.handle)
    .limit(limit);
  return rows.flatMap(({ handle, ...row }) => (handle ? [{ ...row, handle }] : []));
}

/** The account's stored handle (lowercase, no "@"), or null until they pick one. */
export async function handleFor(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ handle: profiles.handle }).from(profiles).where(eq(profiles.userId, userId));
  return row?.handle ?? null;
}

/** A real account's rank, from its handle (app/lib/rank.ts rankForHandle); signed out → VIEWER_RANK. */
export async function rankForUser(userId: string | undefined): Promise<string> {
  return rankForHandle(userId ? await handleFor(userId) : null);
}

/** Clerk user id holding `handle` (stored form: lowercase, no "@"), or null. */
export async function handleOwner(handle: string): Promise<string | null> {
  const [row] = await getDb().select({ userId: profiles.userId }).from(profiles).where(eq(profiles.handle, handle));
  return row?.userId ?? null;
}

export async function bannerImageFor(userId: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await getDb()
    .select({ image: profiles.bannerImage, mime: profiles.bannerMime })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!row?.image || !row.mime) return null;
  return { mime: row.mime, bytes: Buffer.from(row.image, "base64") };
}

export async function avatarImageFor(userId: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!embeddedWalletAuthEnabled()) return null;
  const [row] = await getDb()
    .select({ image: profiles.avatarImage, mime: profiles.avatarMime })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!row?.image || !row.mime) return null;
  return { mime: row.mime, bytes: Buffer.from(row.image, "base64") };
}

// "keep" leaves the stored banner alone; otherwise a preset and an image are
// mutually exclusive, so setting one always clears the other.
export type BannerUpdate =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "preset"; id: string }
  | { kind: "image"; mime: string; base64: string };

function bannerColumns(banner: BannerUpdate) {
  switch (banner.kind) {
    case "keep":
      return {};
    case "none":
      return { bannerPreset: null, bannerImage: null, bannerMime: null };
    case "preset":
      return { bannerPreset: banner.id, bannerImage: null, bannerMime: null };
    case "image":
      return { bannerPreset: null, bannerImage: banner.base64, bannerMime: banner.mime };
  }
}

export type AvatarUpdate =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "image"; mime: string; base64: string };

function avatarColumns(avatar: AvatarUpdate) {
  switch (avatar.kind) {
    case "keep":
      return {};
    case "none":
      return { avatarImage: null, avatarMime: null };
    case "image":
      return { avatarImage: avatar.base64, avatarMime: avatar.mime };
  }
}

const isUniqueViolation = (error: unknown) => {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
};

/**
 * One upsert per save. "handle-taken" when the unique index rejects the
 * handle. Fields left out keep their stored value (the /welcome flow only
 * sends name, handle and bio).
 */
export async function saveStoredProfile(
  userId: string,
  fields: Partial<ProfileFields>,
  banner: BannerUpdate,
  avatar: AvatarUpdate = { kind: "keep" },
): Promise<"ok" | "handle-taken"> {
  const set = {
    ...fields,
    ...bannerColumns(banner),
    ...(embeddedWalletAuthEnabled() ? avatarColumns(avatar) : {}),
    updatedAt: new Date(),
  };
  try {
    await getDb()
      .insert(profiles)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: profiles.userId, set });
    return "ok";
  } catch (error) {
    if (isUniqueViolation(error)) return "handle-taken";
    throw error;
  }
}
