"use server";

import { auth } from "@clerk/nextjs/server";
import { refresh } from "next/cache";
import { PROFILES } from "@/app/lib/mockProfiles";
import {
  BANNER_MAX_BYTES,
  BANNER_TYPES,
  PROFILE_LIMITS,
  handleProblem,
  isBannerPreset,
  normalizeHandle,
  normalizeWebsite,
} from "@/app/lib/profileEdit";
import { MAX_PINS, isPinnableMatch } from "@/app/lib/profileTraits";
import { historyEntryFor, settledMatchesByIds } from "@/lib/match";
import { handleOwner, savePinnedMatches, saveStoredProfile, storedProfileFor, type BannerUpdate } from "@/lib/profile";

export type ProfileField = keyof typeof PROFILE_LIMITS | "banner";
export type SaveProfileResult = { ok: true } | { ok: false; error: string; field?: ProfileField };
type TextField = keyof typeof PROFILE_LIMITS;

// Mock feed authors keep their handles, plus a few that would read as staff.
const RESERVED_HANDLES = new Set([...PROFILES.map((profile) => profile.handle.slice(1)), "admin", "me", "you", "oracle", "prophecy", "support"]);

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
 * The avatar isn't part of this — the dialog sends it straight to Clerk.
 */
export async function saveProfile(formData: FormData): Promise<SaveProfileResult> {
  const { userId } = await auth();
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
    banner = { kind: "image", mime: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
  } else if (isBannerPreset(bannerChoice)) {
    banner = { kind: "preset", id: bannerChoice };
  } else {
    return { ok: false, field: "banner", error: "Pick a banner." };
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
  );
  if (saved === "handle-taken") return HANDLE_TAKEN;

  refresh();
  return { ok: true };
}

/**
 * The profile step of /welcome (app/welcome/OnboardingFlow.tsx): name,
 * handle and bio only — location, website and banner keep their stored
 * values. Unlike Edit profile, name and handle are required here. Same
 * rules as saveProfile; the photo goes to Clerk from the client.
 */
export async function saveProfileBasics(formData: FormData): Promise<SaveProfileResult> {
  const { userId } = await auth();
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
  const { userId } = await auth();
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
  const { userId } = await auth();
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
