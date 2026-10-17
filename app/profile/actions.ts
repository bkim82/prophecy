"use server";

import { refresh } from "next/cache";
import { PROFILES } from "@/app/lib/mockProfiles";
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  BANNER_MAX_BYTES,
  BANNER_TYPES,
  PROFILE_LIMITS,
  handleProblem,
  isBannerPreset,
  normalizeHandle,
  normalizeWebsite,
} from "@/app/lib/profileEdit";
import { inspectProfileImage } from "@/app/lib/profileImage";
import { MAX_PINS, isPinnableMatch } from "@/app/lib/profileTraits";
import { historyEntryFor, settledMatchesByIds } from "@/lib/match";
import {
  savePinnedMatches,
  saveStoredProfile,
  storedProfileFor,
  type AvatarUpdate,
  type BannerUpdate,
} from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export type ProfileField = keyof typeof PROFILE_LIMITS | "avatar" | "banner";
export type SaveProfileResult = { ok: true } | { ok: false; error: string; field?: ProfileField };

// Mock feed authors keep their handles, plus a few that would read as staff.
const RESERVED_HANDLES = new Set([...PROFILES.map((profile) => profile.handle.slice(1)), "admin", "me", "you", "oracle", "prophecy", "support"]);

const LABELS: Record<keyof typeof PROFILE_LIMITS, string> = {
  displayName: "Name",
  handle: "Handle",
  bio: "Bio",
  location: "Location",
  website: "Website",
};

/**
 * Saves the signed-in user's own profile from the Edit profile dialog. Every
 * rule the dialog shows is re-checked here; the dialog is only a preview.
 * Text and both images are committed in one profile upsert.
 */
export async function saveProfile(formData: FormData): Promise<SaveProfileResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to edit your profile." };

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const raw = {
    displayName: text("displayName"),
    handle: normalizeHandle(text("handle")),
    // At most one blank line in a row.
    bio: text("bio").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n"),
    location: text("location"),
    website: text("website"),
  };
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof typeof PROFILE_LIMITS)[]) {
    if (raw[key].length > PROFILE_LIMITS[key]) {
      return { ok: false, field: key, error: `${LABELS[key]} can be at most ${PROFILE_LIMITS[key]} characters.` };
    }
  }

  if (raw.handle) {
    const problem = handleProblem(raw.handle);
    if (problem) return { ok: false, field: "handle", error: problem };
    if (RESERVED_HANDLES.has(raw.handle)) return { ok: false, field: "handle", error: "That handle is taken." };
  }

  const website = raw.website ? normalizeWebsite(raw.website) : null;
  if (raw.website && !website) return { ok: false, field: "website", error: "Enter a web address like example.com." };

  const bannerChoice = text("banner");
  let banner: BannerUpdate;
  if (bannerChoice === "keep" || bannerChoice === "none") {
    banner = { kind: bannerChoice };
  } else if (bannerChoice === "image") {
    const file = formData.get("bannerFile");
    if (!(file instanceof File) || !BANNER_TYPES.includes(file.type)) {
      return { ok: false, field: "banner", error: "Banner must be a JPEG, PNG or WebP image." };
    }
    if (file.size > BANNER_MAX_BYTES) return { ok: false, field: "banner", error: "That banner is too large — try a smaller image." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      inspectProfileImage(bytes, file.type, "banner");
    } catch {
      return { ok: false, field: "banner", error: "That banner isn't a valid JPEG, PNG or WebP image." };
    }
    banner = { kind: "image", mime: file.type, base64: Buffer.from(bytes).toString("base64") };
  } else if (isBannerPreset(bannerChoice)) {
    banner = { kind: "preset", id: bannerChoice };
  } else {
    return { ok: false, field: "banner", error: "Pick a banner." };
  }

  const avatarChoice = text("avatar");
  let avatar: AvatarUpdate;
  if (avatarChoice === "keep" || avatarChoice === "none") {
    avatar = { kind: avatarChoice };
  } else if (avatarChoice === "image") {
    const file = formData.get("avatarFile");
    if (!(file instanceof File) || !AVATAR_TYPES.includes(file.type)) {
      return { ok: false, field: "avatar", error: "Photo must be a JPEG, PNG or WebP image." };
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return { ok: false, field: "avatar", error: "That photo is too large; try a smaller image." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      inspectProfileImage(bytes, file.type, "avatar");
    } catch {
      return { ok: false, field: "avatar", error: "That photo isn't a valid square JPEG, PNG or WebP image." };
    }
    avatar = { kind: "image", mime: file.type, base64: Buffer.from(bytes).toString("base64") };
  } else {
    return { ok: false, field: "avatar", error: "Pick a profile photo." };
  }

  const saved = await saveStoredProfile(
    userId,
    {
      displayName: raw.displayName || null,
      handle: raw.handle || null,
      bio: raw.bio || null,
      location: raw.location || null,
      website,
    },
    banner,
    avatar,
  );
  if (saved === "handle-taken") return { ok: false, field: "handle", error: "That handle is taken." };

  refresh();
  return { ok: true };
}

/**
 * Pins or unpins one of your won Arena matches in the highlight reel (up to
 * MAX_PINS, kept in pin order). Only a settled match you played, won, and
 * finished in profit can be pinned; unpinning always works.
 */
export async function togglePinnedMatch(matchId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to manage your highlight reel." };

  const pinned = (await storedProfileFor(userId))?.pinnedMatches ?? [];
  let next: string[];
  if (pinned.includes(matchId)) {
    next = pinned.filter((id) => id !== matchId);
  } else {
    if (pinned.length >= MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} — unpin one first.` };
    const [row] = await settledMatchesByIds(userId, [matchId]);
    if (!row || !isPinnableMatch(historyEntryFor(row, userId))) return { ok: false, error: "Only matches you won in profit can be pinned." };
    next = [...pinned, matchId];
  }

  await savePinnedMatches(userId, next);
  refresh();
  return { ok: true };
}
