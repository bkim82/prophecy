// Field rules and banner presets for the own-profile editor — imported by
// both the client dialog (app/profile/EditProfileDialog.tsx: maxLength,
// counters, previews) and the server action that enforces them
// (app/profile/actions.ts). No server-only imports, so it stays client-safe.

export const PROFILE_LIMITS = { displayName: 50, handle: 20, bio: 160, location: 30, website: 100 } as const;

// 3–20 of a–z 0–9 _ . — no leading/trailing dot, no "..". Stored lowercase, no "@".
const HANDLE_PATTERN = /^[a-z0-9_][a-z0-9_.]{1,18}[a-z0-9_]$/;

export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

export function handleProblem(handle: string): string | null {
  if (!HANDLE_PATTERN.test(handle) || handle.includes("..")) {
    return "3–20 letters, numbers, _ or . (no dot at the start or end)";
  }
  return null;
}

// "example.com/me" -> "https://example.com/me". Null unless it parses as an
// http(s) URL, so a stored website can never be a javascript: link.
export function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// "https://www.example.com/me/" -> "example.com/me"
export function websiteLabel(website: string): string {
  try {
    const url = new URL(website);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return website;
  }
}

export const BANNER_MAX_BYTES = 512 * 1024;
export const BANNER_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Prophecy's own motifs, so a banner reads as part of the app: the Oracle's
// sunburst (OraclesLeaderboard rays), the doom → destiny call track, the
// liquidated-call hazard stripes, the tarot card back, rising embers, an
// eclipse. Same in every theme: a banner is artwork, not chrome.
export const BANNER_PRESETS = [
  {
    id: "oracle-eye",
    label: "The Oracle's Eye",
    background:
      "radial-gradient(circle at 50% 120%, rgba(240, 236, 255, .85) 0 18px, rgba(183, 167, 246, .5) 26px, transparent 90px), repeating-conic-gradient(from -90deg at 50% 120%, rgba(214, 206, 255, .16) 0 2.5deg, transparent 2.5deg 9deg), radial-gradient(80% 140% at 50% 120%, #6d55c9, transparent 70%), #110e1f",
  },
  {
    id: "destiny",
    label: "Destiny",
    background:
      "linear-gradient(transparent calc(62% - 1px), rgba(245, 205, 98, .5) calc(62% - 1px) calc(62% + 1px), transparent calc(62% + 1px)), radial-gradient(circle at 86% 62%, #fff4cf 0 4px, rgba(245, 205, 98, .7) 7px, rgba(217, 169, 55, .25) 26px, transparent 70px), linear-gradient(90deg, #120f1e 0%, #1d1830 50%, #3c2c0b 100%)",
  },
  {
    id: "doom",
    label: "Doom",
    background:
      "repeating-linear-gradient(135deg, rgba(236, 104, 114, .14) 0 10px, transparent 10px 24px), radial-gradient(55% 130% at 10% 50%, rgba(236, 104, 114, .5), transparent 70%), linear-gradient(90deg, #2a0d14, #120a10 70%)",
  },
  {
    id: "tarot",
    label: "Tarot",
    background:
      "radial-gradient(circle at 50% 50%, rgba(183, 167, 246, .34), transparent 42%), repeating-linear-gradient(45deg, rgba(183, 167, 246, .12) 0 1px, transparent 1px 12px), repeating-linear-gradient(-45deg, rgba(183, 167, 246, .12) 0 1px, transparent 1px 12px), #1a1530",
  },
  {
    id: "embers",
    label: "Embers",
    background:
      "radial-gradient(circle at 12% 70%, #f0d89a 0 1.5px, transparent 2.5px), radial-gradient(circle at 27% 38%, #d6cbff 0 1px, transparent 2px), radial-gradient(circle at 41% 82%, #f0d89a 0 2px, transparent 3px), radial-gradient(circle at 58% 30%, #f0d89a 0 1px, transparent 2px), radial-gradient(circle at 66% 64%, #d6cbff 0 1.5px, transparent 2.5px), radial-gradient(circle at 79% 22%, #f0d89a 0 1.5px, transparent 2.5px), radial-gradient(circle at 90% 74%, #d6cbff 0 1px, transparent 2px), radial-gradient(90% 70% at 50% 120%, rgba(240, 200, 110, .4), transparent 70%), #100e1a",
  },
  {
    id: "eclipse",
    label: "Eclipse",
    background:
      "radial-gradient(circle at 74% 50%, #07060d 0 44px, rgba(240, 236, 255, .95) 46px, rgba(160, 124, 240, .55) 52px, rgba(160, 124, 240, .12) 80px, transparent 130px), radial-gradient(70% 120% at 0% 100%, rgba(95, 211, 240, .18), transparent 70%), #0b0916",
  },
] as const;

export const isBannerPreset = (id: string) => BANNER_PRESETS.some((preset) => preset.id === id);

export type ProfileBanner = { kind: "preset"; id: string } | { kind: "image"; url: string };

// CSS `background` for a banner; undefined for an unknown preset id.
export function bannerBackground(banner: ProfileBanner): string | undefined {
  if (banner.kind === "image") return `center / cover no-repeat url("${banner.url}")`;
  return BANNER_PRESETS.find((preset) => preset.id === banner.id)?.background;
}
