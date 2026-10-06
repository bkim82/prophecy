import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";

// Reads/writes for the `profiles` table (db/schema.ts). Validation lives in
// app/profile/actions.ts; this layer only stores what it's handed.

export type ProfileFields = {
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
};

// Everything the page needs except the banner bytes, which stay in the
// table until GET /api/profile/banner asks for them.
export type StoredProfile = ProfileFields & { bannerPreset: string | null; hasBannerImage: boolean; pinnedMatches: string[]; updatedAt: Date };

export async function storedProfileFor(userId: string): Promise<StoredProfile | null> {
  const [row] = await getDb()
    .select({
      displayName: profiles.displayName,
      handle: profiles.handle,
      bio: profiles.bio,
      location: profiles.location,
      website: profiles.website,
      bannerPreset: profiles.bannerPreset,
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

export async function bannerImageFor(userId: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await getDb()
    .select({ image: profiles.bannerImage, mime: profiles.bannerMime })
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

const isUniqueViolation = (error: unknown) => {
  const { code, cause } = (error ?? {}) as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
};

/** One upsert per save. "handle-taken" when the unique index rejects the handle. */
export async function saveStoredProfile(userId: string, fields: ProfileFields, banner: BannerUpdate): Promise<"ok" | "handle-taken"> {
  const set = { ...fields, ...bannerColumns(banner), updatedAt: new Date() };
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
