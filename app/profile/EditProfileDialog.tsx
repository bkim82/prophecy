"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CameraIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import {
  AVATAR_MAX_BYTES,
  BANNER_MAX_BYTES,
  BANNER_PRESETS,
  IMAGE_ACCEPT,
  PROFILE_LIMITS,
  bannerBackground,
  handleProblem,
  normalizeHandle,
  type ProfileBanner,
} from "@/app/lib/profileEdit";
import { saveProfile, type ProfileField } from "@/app/profile/actions";

// Edit profile on /profile: banner (preset or upload), photo, name, handle,
// bio, location, website. Mounted only while open, so each open starts from
// the saved values. Text fields + banner go through the saveProfile server
// action (which re-validates everything); the photo goes straight to Clerk
// after that succeeds, so the header avatar updates too.

export type EditableProfile = {
  displayName: string;
  // Clerk's name — what shows while displayName is empty.
  namePlaceholder: string;
  handle: string;
  bio: string;
  location: string;
  website: string;
  banner: ProfileBanner | null;
  // Null when the Clerk account has no uploaded photo.
  avatarUrl: string | null;
  avatarInitial: string;
  avatarSeed: string;
};

type BannerDraft = { kind: "keep" } | { kind: "none" } | { kind: "preset"; id: string } | { kind: "image"; file: File; previewUrl: string };
type AvatarDraft = { kind: "keep" } | { kind: "remove" } | { kind: "new"; file: File; previewUrl: string };
type FormError = { message: string; field?: ProfileField | "avatar" };

const BANNER_WIDTH = 1500;
const BANNER_RATIO = 3;

// Center-crops to 3:1 and re-encodes as JPEG, stepping quality down until it
// fits under BANNER_MAX_BYTES (the server rejects anything bigger).
async function cropBanner(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > BANNER_RATIO) sw = sh * BANNER_RATIO;
  else sh = sw / BANNER_RATIO;
  const width = Math.min(BANNER_WIDTH, Math.round(sw));
  const height = Math.round(width / BANNER_RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= BANNER_MAX_BYTES) return new File([blob], "banner.jpg", { type: "image/jpeg" });
  }
  throw new Error("Banner too large");
}

export function EditProfileDialog({ initial, onClose }: { initial: EditableProfile; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const id = useId();
  const router = useRouter();
  const clerk = useClerk();
  const { user } = useUser();
  const [fields, setFields] = useState({
    displayName: initial.displayName,
    handle: initial.handle,
    bio: initial.bio,
    location: initial.location,
    website: initial.website,
  });
  const [banner, setBanner] = useState<BannerDraft>({ kind: "keep" });
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: "keep" });
  const [error, setError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const preview = (file: File) => {
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    return url;
  };

  const shownBanner: ProfileBanner | null =
    banner.kind === "keep" ? initial.banner
    : banner.kind === "none" ? null
    : banner.kind === "preset" ? { kind: "preset", id: banner.id }
    : { kind: "image", url: banner.previewUrl };
  const shownAvatar = avatar.kind === "new" ? avatar.previewUrl : avatar.kind === "remove" ? null : initial.avatarUrl;
  const selectedPreset = shownBanner?.kind === "preset" ? shownBanner.id : null;

  const handle = normalizeHandle(fields.handle);
  const handleIssue = handle ? handleProblem(handle) : null;
  const fieldError = (field: NonNullable<FormError["field"]>) => (error && error.field === field ? error.message : null);
  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    if (error?.field === key) setError(null);
  };

  async function pickBanner(file: File | undefined) {
    if (!file) return;
    try {
      const cropped = await cropBanner(file);
      setBanner({ kind: "image", file: cropped, previewUrl: preview(cropped) });
      setError(null);
    } catch {
      setError({ field: "banner", message: "Couldn't use that image — try a JPEG, PNG or WebP." });
    }
  }

  function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_ACCEPT.split(",").includes(file.type) || file.size > AVATAR_MAX_BYTES) {
      setError({ field: "avatar", message: "Photo must be a JPEG, PNG or WebP under 10 MB." });
      return;
    }
    setAvatar({ kind: "new", file, previewUrl: preview(file) });
    setError(null);
  }

  function save() {
    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) formData.set(key, value);
      formData.set("banner", banner.kind === "preset" ? banner.id : banner.kind);
      if (banner.kind === "image") formData.set("bannerFile", banner.file);

      try {
        const result = await saveProfile(formData);
        if (!result.ok) return setError({ message: result.error, field: result.field });
      } catch {
        return setError({ message: "Couldn't save your profile — try again." });
      }

      if (avatar.kind !== "keep" && user) {
        try {
          await user.setProfileImage({ file: avatar.kind === "new" ? avatar.file : null });
          router.refresh();
        } catch {
          return setError({ field: "avatar", message: "Profile saved, but the photo didn't update — try another image." });
        }
      }
      dialogRef.current?.close();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="profile-edit"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      // Esc closes like Cancel, but not mid-save.
      onCancel={(event) => pending && event.preventDefault()}
    >
      <form
        className="profile-edit-panel"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <header className="profile-edit-head">
          <h2 id={`${id}-title`}>Edit profile</h2>
          <button type="button" className="profile-edit-close" aria-label="Close" disabled={pending} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>

        <div className="profile-edit-body">
          <div className="profile-edit-media">
            <div className="profile-edit-banner" style={{ background: shownBanner ? bannerBackground(shownBanner) : undefined }}>
              <div className="profile-edit-banner-actions">
                <button type="button" onClick={() => bannerInput.current?.click()}>
                  <CameraIcon /> Upload banner
                </button>
                {shownBanner && (
                  <button type="button" onClick={() => setBanner({ kind: "none" })}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="profile-edit-avatar-row">
              <button
                type="button"
                className="profile-edit-avatar"
                aria-label="Change photo"
                style={{ background: avatarGradient(initial.avatarSeed) }}
                onClick={() => avatarInput.current?.click()}
              >
                {shownAvatar ? <img src={shownAvatar} alt="" /> : initial.avatarInitial}
                <span className="profile-edit-avatar-overlay" aria-hidden="true">
                  <CameraIcon />
                </span>
              </button>
              {shownAvatar && (
                <button type="button" className="profile-edit-text-button" onClick={() => setAvatar({ kind: "remove" })}>
                  Remove photo
                </button>
              )}
            </div>
            {/* Value cleared after each pick so choosing the same file again still fires. */}
            <input
              ref={bannerInput}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(event) => {
                void pickBanner(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={avatarInput}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(event) => {
                pickAvatar(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {(fieldError("banner") ?? fieldError("avatar")) && (
              <p className="profile-edit-error" role="alert">
                {fieldError("banner") ?? fieldError("avatar")}
              </p>
            )}
          </div>

          <fieldset className="profile-edit-presets">
            <legend>Banner presets</legend>
            <div>
              {BANNER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="profile-edit-swatch"
                  aria-pressed={selectedPreset === preset.id}
                  aria-label={preset.label}
                  title={preset.label}
                  onClick={() => setBanner({ kind: "preset", id: preset.id })}
                >
                  {/* Drawn at banner scale, then shrunk, so px-sized motifs (eclipse ring, ✦ glow) look as they will on the banner. */}
                  <span aria-hidden="true" style={{ background: preset.background }} />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="profile-edit-grid">
            <Field id={`${id}-name`} label="Name" count={fields.displayName.length} limit={PROFILE_LIMITS.displayName} error={fieldError("displayName")}>
              <input
                id={`${id}-name`}
                value={fields.displayName}
                placeholder={initial.namePlaceholder}
                maxLength={PROFILE_LIMITS.displayName}
                autoComplete="nickname"
                onChange={set("displayName")}
              />
            </Field>
            <Field id={`${id}-handle`} label="Handle" error={fieldError("handle") ?? handleIssue} hint="Letters, numbers, _ and .">
              <span className="profile-edit-prefixed">
                <span aria-hidden="true">@</span>
                <input
                  id={`${id}-handle`}
                  value={fields.handle}
                  maxLength={PROFILE_LIMITS.handle + 1}
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  onChange={set("handle")}
                />
              </span>
            </Field>
            <Field id={`${id}-bio`} label="Bio" wide count={fields.bio.length} limit={PROFILE_LIMITS.bio} error={fieldError("bio")}>
              <textarea id={`${id}-bio`} value={fields.bio} rows={3} maxLength={PROFILE_LIMITS.bio} onChange={set("bio")} />
            </Field>
            <Field id={`${id}-location`} label="Location" error={fieldError("location")}>
              <input id={`${id}-location`} value={fields.location} maxLength={PROFILE_LIMITS.location} onChange={set("location")} />
            </Field>
            <Field id={`${id}-website`} label="Website" error={fieldError("website")}>
              <input
                id={`${id}-website`}
                value={fields.website}
                placeholder="example.com"
                maxLength={PROFILE_LIMITS.website}
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                onChange={set("website")}
              />
            </Field>
          </div>

          {error && !error.field && (
            <p className="profile-edit-error" role="alert">
              {error.message}
            </p>
          )}
        </div>

        <footer className="profile-edit-foot">
          <button
            type="button"
            className="profile-edit-text-button"
            onClick={() => {
              // Clerk's modal can't sit above a native modal dialog.
              dialogRef.current?.close();
              clerk.openUserProfile();
            }}
          >
            Email, password &amp; security →
          </button>
          <div className="profile-edit-buttons">
            <button type="button" className="profile-follow is-following" disabled={pending} onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="profile-follow" disabled={pending || Boolean(handleIssue)}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function Field({
  id,
  label,
  children,
  error,
  hint,
  count,
  limit,
  wide,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string;
  count?: number;
  limit?: number;
  wide?: boolean;
}) {
  return (
    <div className={`profile-edit-field${wide ? " is-wide" : ""}${error ? " has-error" : ""}`}>
      <div className="profile-edit-label">
        <label htmlFor={id}>{label}</label>
        {limit !== undefined && (
          <span className="muted">
            {count}/{limit}
          </span>
        )}
      </div>
      {children}
      {(error ?? hint) && <p className={error ? "profile-edit-error" : "profile-edit-hint muted"}>{error ?? hint}</p>}
    </div>
  );
}
