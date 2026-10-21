import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  BANNER_MAX_BYTES,
  BANNER_TYPES,
} from "@/app/lib/profileEdit";

type ProfileImageKind = "avatar" | "banner";
type ImageInfo = { mime: string; width: number; height: number };

const read16be = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];
const read24le = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const read32be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
const read32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

function pngInfo(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || ascii(bytes, 1, 3) !== "PNG"
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || ascii(bytes, 12, 4) !== "IHDR"
  ) return null;
  return { mime: "image/png", width: read32be(bytes, 16), height: read32be(bytes, 20) };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) return null;
    const length = read16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_SOF.has(marker) && length >= 7) {
      return {
        mime: "image/jpeg",
        height: read16be(bytes, offset + 3),
        width: read16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function webpInfo(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length < 30
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 4) !== "WEBP"
    || read32le(bytes, 4) + 8 > bytes.length
  ) return null;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = read32le(bytes, offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (type === "VP8X" && size >= 10) {
      return { mime: "image/webp", width: read24le(bytes, data + 4) + 1, height: read24le(bytes, data + 7) + 1 };
    }
    if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = read32le(bytes, data + 1);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (
      type === "VP8 "
      && size >= 10
      && bytes[data + 3] === 0x9d
      && bytes[data + 4] === 0x01
      && bytes[data + 5] === 0x2a
    ) {
      return {
        mime: "image/webp",
        width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
        height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
      };
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function gifInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 10 || (ascii(bytes, 0, 6) !== "GIF87a" && ascii(bytes, 0, 6) !== "GIF89a")) return null;
  return { mime: "image/gif", width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
}

// Type and size from the file's own header. GIF is only accepted where the
// caller allows it (post photos, app/lib/postImage.ts), never for profiles.
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  return pngInfo(bytes) ?? jpegInfo(bytes) ?? webpInfo(bytes) ?? gifInfo(bytes);
}

export function inspectProfileImage(
  bytes: Uint8Array,
  declaredMime: string,
  kind: ProfileImageKind,
): ImageInfo {
  const allowed = kind === "avatar" ? AVATAR_TYPES : BANNER_TYPES;
  const maxBytes = kind === "avatar" ? AVATAR_MAX_BYTES : BANNER_MAX_BYTES;
  if (!allowed.includes(declaredMime) || bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error("unsupported-image");
  }

  const info = imageInfo(bytes);
  if (!info || info.mime !== declaredMime || info.width < 1 || info.height < 1) {
    throw new Error("invalid-image");
  }

  const maxDimension = kind === "avatar" ? 1024 : 4096;
  const maxPixels = kind === "avatar" ? 1024 * 1024 : 12 * 1024 * 1024;
  if (
    info.width > maxDimension
    || info.height > maxDimension
    || info.width * info.height > maxPixels
    || (kind === "avatar" && info.width !== info.height)
  ) {
    throw new Error("invalid-dimensions");
  }
  return info;
}

export function profileImageResponse(
  image: { mime: string; bytes: Uint8Array },
  cacheControl: string,
): Response {
  if (!BANNER_TYPES.includes(image.mime)) throw new Error("invalid-image-mime");
  return new Response(image.bytes.slice(), {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Disposition": "inline",
      "Content-Length": String(image.bytes.byteLength),
      "Content-Type": image.mime,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
