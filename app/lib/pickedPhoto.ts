"use client";

import { POST_IMAGE_MAX_BYTES, POST_IMAGE_MAX_SIDE } from "@/app/lib/postImage";

// Photos picked in the browser — the post composer (app/compose/Composer.tsx)
// and the Messages dock (app/MessagesDock.tsx). Both upload the same shape,
// which POST /api/posts and POST /api/messages/thread re-check from the bytes
// (lib/postInput.ts parsePhotos).

// What you can pick; each is shrunk to POST_IMAGE_MAX_BYTES before upload.
export const PICKED_PHOTO_MAX_BYTES = 20 * 1024 * 1024;

// `src` is a blob: URL for the preview; revoke it when the photo is dropped.
export type PickedPhoto = { src: string; width: number; height: number; file: File };

export function loadPhoto(file: File): Promise<PickedPhoto | null> {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src, width: img.naturalWidth || 1, height: img.naturalHeight || 1, file });
    img.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(null);
    };
    img.src = src;
  });
}

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// A photo as the upload routes take it: a GIF that already fits goes as-is
// (keeps its animation); anything else is redrawn no larger than
// POST_IMAGE_MAX_SIDE and saved as JPEG, stepping quality down until it fits
// POST_IMAGE_MAX_BYTES. Null if it still won't fit.
export async function encodePhoto(photo: PickedPhoto): Promise<{ mime: string; data: string } | null> {
  if (photo.file.type === "image/gif" && photo.file.size <= POST_IMAGE_MAX_BYTES) {
    return { mime: "image/gif", data: await toBase64(photo.file) };
  }
  const img = new Image();
  img.src = photo.src;
  await img.decode();
  const scale = Math.min(1, POST_IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  // JPEG has no transparency; paint it white rather than black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.74, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= POST_IMAGE_MAX_BYTES) return { mime: "image/jpeg", data: await toBase64(blob) };
  }
  return null;
}
