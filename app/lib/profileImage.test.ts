import { describe, expect, it } from "vitest";
import { inspectProfileImage, profileImageResponse } from "@/app/lib/profileImage";

const write32be = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  write32be(bytes, 16, width);
  write32be(bytes, 20, height);
  return bytes;
}

function jpeg(width: number, height: number) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
}

function webp(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set([...Buffer.from("RIFF"), 22, 0, 0, 0, ...Buffer.from("WEBPVP8X"), 10, 0, 0, 0], 0);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set([
    widthMinusOne & 0xff,
    (widthMinusOne >>> 8) & 0xff,
    (widthMinusOne >>> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >>> 8) & 0xff,
    (heightMinusOne >>> 16) & 0xff,
  ], 24);
  return bytes;
}

describe("inspectProfileImage", () => {
  it.each([
    ["image/png", png(320, 320)],
    ["image/jpeg", jpeg(320, 320)],
    ["image/webp", webp(320, 320)],
  ])("accepts a real %s avatar", (mime, bytes) => {
    expect(inspectProfileImage(bytes, mime, "avatar")).toEqual({ mime, width: 320, height: 320 });
  });

  it("rejects a declared MIME that does not match the bytes", () => {
    expect(() => inspectProfileImage(png(320, 320), "image/jpeg", "avatar")).toThrow("invalid-image");
  });

  it("rejects non-square avatars", () => {
    expect(() => inspectProfileImage(png(640, 320), "image/png", "avatar")).toThrow("invalid-dimensions");
  });

  it("allows a wide banner but caps dimensions", () => {
    expect(inspectProfileImage(png(1500, 500), "image/png", "banner")).toMatchObject({ width: 1500, height: 500 });
    expect(() => inspectProfileImage(png(5000, 500), "image/png", "banner")).toThrow("invalid-dimensions");
  });

  it("rejects arbitrary bytes", () => {
    expect(() => inspectProfileImage(Uint8Array.from([1, 2, 3]), "image/png", "avatar")).toThrow("invalid-image");
  });
});

describe("profileImageResponse", () => {
  it("sets safe inline image headers", async () => {
    const bytes = png(32, 32);
    const response = profileImageResponse(
      { mime: "image/png", bytes },
      "private, max-age=31536000, immutable",
    );

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("refuses a stored MIME outside the allowlist", () => {
    expect(() => profileImageResponse(
      { mime: "image/svg+xml", bytes: Uint8Array.from([1]) },
      "private, no-cache",
    )).toThrow("invalid-image-mime");
  });
});
