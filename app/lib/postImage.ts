import { imageInfo } from "@/app/lib/profileImage";

// Composer photos (app/compose/Composer.tsx): the browser re-encodes each one
// to a JPEG no wider/taller than POST_IMAGE_MAX_SIDE (a GIF goes as-is to keep
// its animation), and POST /api/posts re-checks type and size from the bytes
// themselves before storing them in `post_media`.
export const MAX_POST_PHOTOS = 4;
export const POST_IMAGE_MAX_BYTES = 1024 * 1024;
export const POST_IMAGE_MAX_SIDE = 1600;
export const POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16 * 1024 * 1024;

export function inspectPostImage(bytes: Uint8Array, declaredMime: string): { mime: string; width: number; height: number } {
  if (!POST_IMAGE_TYPES.includes(declaredMime) || bytes.length === 0 || bytes.length > POST_IMAGE_MAX_BYTES) {
    throw new Error("unsupported-image");
  }
  const info = imageInfo(bytes);
  if (!info || info.mime !== declaredMime || info.width < 1 || info.height < 1) throw new Error("invalid-image");
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION || info.width * info.height > MAX_PIXELS) {
    throw new Error("invalid-dimensions");
  }
  return info;
}
