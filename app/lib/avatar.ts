// Deterministic hash so the same handle always gets the same gradient —
// stands in for a real avatar image without needing asset uploads.
export function hueFromHandle(handle: string): number {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash << 5) - hash + handle.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

// Muted by default: avatars tell people apart but shouldn't compete with the
// feed's accent colors. PostMedia's fake screenshots pass a full 70% so they
// still read as real, full-color images.
export function avatarGradient(handle: string, saturation = 42): string {
  const hue = hueFromHandle(handle);
  return `linear-gradient(135deg, hsl(${hue} ${saturation}% 45%), hsl(${(hue + 45) % 360} ${saturation}% 32%))`;
}
