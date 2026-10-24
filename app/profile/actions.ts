"use server";

import { refresh } from "next/cache";
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
import { isBlockedEitherWay, saveBlock } from "@/lib/blocks";
import { followTarget, saveFollow } from "@/lib/follows";
import { historyEntryFor, settledMatchesByIds } from "@/lib/match";
import {
  handleOwner,
  savePinnedMatches,
  saveStoredProfile,
  storedProfileFor,
  type AvatarUpdate,
  type BannerUpdate,
} from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export type ProfileField = keyof typeof PROFILE_LIMITS | "avatar" | "banner";
export type SaveProfileResult = { ok: true } | { ok: false; error: string; field?: ProfileField };
type TextField = keyof typeof PROFILE_LIMITS;

// Handles that would read as staff.
const RESERVED_HANDLES = new Set(["admin", "me", "you", "oracle", "prophecy", "support"]);

const LABELS: Record<TextField, string> = {
  displayName: "Name",
  handle: "Handle",
  bio: "Bio",
  location: "Location",
  website: "Website",
};

type SaveProfileError = Extract<SaveProfileResult, { ok: false }>;

const HANDLE_TAKEN: SaveProfileError = { ok: false, field: "handle", error: "That handle is taken." };

const formText = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

// Trimmed text fields from the form; handle normalized, at most one blank line in a row in the bio.
function readTextFields(formData: FormData): Record<TextField, string> {
  const text = (key: string) => formText(formData, key);
  return {
    displayName: text("displayName"),
    handle: normalizeHandle(text("handle")),
    bio: text("bio").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n"),
    location: text("location"),
    website: text("website"),
  };
}

// First length/handle rule that `fields` of `raw` break; a blank handle passes.
function textProblem(raw: Record<TextField, string>, fields: TextField[]): SaveProfileError | null {
  for (const key of fields) {
    if (raw[key].length > PROFILE_LIMITS[key]) {
      return { ok: false, field: key, error: `${LABELS[key]} can be at most ${PROFILE_LIMITS[key]} characters.` };
    }
  }
  if (fields.includes("handle") && raw.handle) {
    const problem = handleProblem(raw.handle);
    if (problem) return { ok: false, field: "handle", error: problem };
    if (RESERVED_HANDLES.has(raw.handle)) return HANDLE_TAKEN;
  }
  return null;
}

/**
 * Saves the signed-in user's own profile from the Edit profile dialog. Every
 * rule the dialog shows is re-checked here; the dialog is only a preview.
 * Text and both images are committed in one profile upsert.
 */
export async function saveProfile(formData: FormData): Promise<SaveProfileResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to edit your profile." };

  const raw = readTextFields(formData);
  const problem = textProblem(raw, Object.keys(PROFILE_LIMITS) as TextField[]);
  if (problem) return problem;

  const website = raw.website ? normalizeWebsite(raw.website) : null;
  if (raw.website && !website) return { ok: false, field: "website", error: "Enter a web address like example.com." };

  const bannerChoice = formText(formData, "banner");
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

  const avatarChoice = formText(formData, "avatar");
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
  if (saved === "handle-taken") return HANDLE_TAKEN;

  refresh();
  return { ok: true };
}

/**
 * The profile step of /welcome (app/welcome/OnboardingFlow.tsx): name,
 * handle and bio only — location, website and banner keep their stored
 * values. Unlike Edit profile, name and handle are required here. Same
 * rules as saveProfile; the photo is uploaded separately by the client.
 */
export async function saveProfileBasics(formData: FormData): Promise<SaveProfileResult> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to set up your profile." };

  const raw = readTextFields(formData);
  if (!raw.displayName) return { ok: false, field: "displayName", error: "Add the name other traders will see." };
  if (!raw.handle) return { ok: false, field: "handle", error: "Pick a handle." };
  const problem = textProblem(raw, ["displayName", "handle", "bio"]);
  if (problem) return problem;

  const saved = await saveStoredProfile(userId, { displayName: raw.displayName, handle: raw.handle, bio: raw.bio || null }, { kind: "keep" });
  return saved === "handle-taken" ? HANDLE_TAKEN : { ok: true };
}

/** Live "is this handle free?" hint for /welcome. Only a hint — saving re-checks against the unique index. */
export async function checkHandle(handle: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to pick a handle." };
  if (typeof handle !== "string") return { ok: false, error: "Pick a handle." };

  const normalized = normalizeHandle(handle);
  const problem = handleProblem(normalized);
  if (problem) return { ok: false, error: problem };
  if (RESERVED_HANDLES.has(normalized)) return HANDLE_TAKEN;
  const owner = await handleOwner(normalized);
  return owner === null || owner === userId ? { ok: true } : HANDLE_TAKEN;
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

/**
 * Follows or unfollows an account from its profile;
 * Challenge re-checks follows both ways (app/profile/challengeActions.ts).
 * No follows across a block either way (lib/blocks.ts). No refresh: the
 * toggle already shows it.
 */
export async function followProfile(handle: string, following: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to follow traders." };
  const target = await followTarget(handle);
  if (!target) return { ok: false, error: "That trader doesn't exist." };
  if (target.userId === userId) return { ok: false, error: "You can't follow yourself." };
  if (following && (await isBlockedEitherWay(userId, target.userId))) {
    return { ok: false, error: `You can't follow ${target.name}.` };
  }
  await saveFollow(userId, target.userId, following === true);
  return { ok: true };
}

/**
 * Blocks or unblocks an account from its profile's ⋯ menu. Blocking
 * unfollows you both and stops messages either way (lib/blocks.ts);
 * refresh() re-renders the profile so Follow, Message and Challenge go at once.
 */
export async function blockProfile(handle: string, blocked: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = (await getViewer())?.userId;
  if (!userId) return { ok: false, error: "Sign in to block accounts." };
  const target = await followTarget(handle);
  if (!target) return { ok: false, error: "That account doesn't exist." };
  if (target.userId === userId) return { ok: false, error: "You can't block yourself." };
  await saveBlock(userId, target.userId, blocked === true);
  refresh();
  return { ok: true };
}
