import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  handleFor: vi.fn(),
  publicProfileFor: vi.fn(),
  isBlockedEitherWay: vi.fn(),
  messageCountSince: vi.fn(),
  saveMessage: vi.fn(),
  sharedPostsFor: vi.fn(),
  threadWith: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/profile", () => ({ handleFor: mocks.handleFor, publicProfileFor: mocks.publicProfileFor }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: mocks.isBlockedEitherWay }));
vi.mock("@/lib/messages", () => ({
  messageCountSince: mocks.messageCountSince,
  saveMessage: mocks.saveMessage,
  sharedPostsFor: mocks.sharedPostsFor,
  threadWith: mocks.threadWith,
}));

import { GET, POST } from "@/app/api/messages/thread/route";
import { MESSAGE_MAX_LENGTH } from "@/app/lib/messageRules";

// 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SAM = { userId: "user_sam", handle: "sam" };
const headers = { origin: "http://localhost", host: "localhost", "content-type": "application/json" };
const send = (body: object, extra: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/messages/thread", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe("POST /api/messages/thread", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue({ userId: "user_me", smartAccountAddress: null });
    mocks.handleFor.mockResolvedValue("me");
    mocks.publicProfileFor.mockImplementation(async (handle: string) => (handle === "sam" ? SAM : handle === "me" ? { userId: "user_me", handle: "me" } : null));
    mocks.isBlockedEitherWay.mockResolvedValue(false);
    mocks.messageCountSince.mockResolvedValue(0);
    mocks.sharedPostsFor.mockResolvedValue(new Map([["g1", { id: "g1" }]]));
    mocks.saveMessage.mockImplementation(async () => ({ id: "m1" }));
  });

  it("needs a same-origin request from someone signed in", async () => {
    expect((await send({ handle: "@sam", body: "hi" }, { origin: "https://evil.example" })).status).toBe(403);
    mocks.getViewer.mockResolvedValue(null);
    expect((await send({ handle: "@sam", body: "hi" })).status).toBe(401);
    expect(mocks.saveMessage).not.toHaveBeenCalled();
  });

  it("sends normalized text to a real account by handle", async () => {
    const response = await send({ handle: "@Sam", body: "  gm  " });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ message: { id: "m1" } });
    expect(mocks.saveMessage).toHaveBeenCalledWith("user_me", "user_sam", { body: "gm", photos: [], postId: null });
  });

  it("sends photos and shared posts, with or without text", async () => {
    expect((await send({ handle: "@sam", photos: [{ mime: "image/png", data: PNG }] })).status).toBe(201);
    expect(mocks.saveMessage).toHaveBeenLastCalledWith("user_me", "user_sam", { body: "", photos: [{ mime: "image/png", base64: PNG, width: 1, height: 1 }], postId: null });
    expect((await send({ handle: "@sam", postId: "g1", body: "look" })).status).toBe(201);
    expect(mocks.saveMessage).toHaveBeenLastCalledWith("user_me", "user_sam", { body: "look", photos: [], postId: "g1" });
  });

  it("rejects empty, too-long, bad photos, deleted posts and too many photos", async () => {
    expect(await errorOf(await send({ handle: "@sam", body: "   " }))).toBe("Write a message first.");
    expect((await send({ handle: "@sam", body: "x".repeat(MESSAGE_MAX_LENGTH + 1) })).status).toBe(400);
    expect((await send({ handle: "@sam", photos: [{ mime: "image/jpeg", data: PNG }] })).status).toBe(400);
    expect((await send({ handle: "@sam", photos: Array(5).fill({ mime: "image/png", data: PNG }) })).status).toBe(400);
    expect((await send({ handle: "@sam", postId: "gone" })).status).toBe(404);
    expect(mocks.saveMessage).not.toHaveBeenCalled();
  });

  it("won't send to you, mock traders or unknown handles, or without a handle of your own", async () => {
    for (const handle of ["@me", "@zane_lfg", "@nobody"]) expect((await send({ handle, body: "hi" })).status).toBe(404);
    mocks.handleFor.mockResolvedValue(null);
    expect(await errorOf(await send({ handle: "@sam", body: "hi" }))).toBe("Choose your @handle on your profile before sending messages.");
    expect(mocks.saveMessage).not.toHaveBeenCalled();
  });

  it("won't send across a block either way", async () => {
    mocks.isBlockedEitherWay.mockResolvedValue(true);
    const response = await send({ handle: "@sam", body: "hi" });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("You can't message @sam.");
    expect(mocks.isBlockedEitherWay).toHaveBeenCalledWith("user_me", "user_sam");
    expect(mocks.saveMessage).not.toHaveBeenCalled();
  });

  it("rate limits fast senders", async () => {
    mocks.messageCountSince.mockResolvedValueOnce(30);
    expect((await send({ handle: "@sam", body: "hi" })).status).toBe(429);
    expect(mocks.saveMessage).not.toHaveBeenCalled();
  });
});

describe("GET /api/messages/thread", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue({ userId: "user_me", smartAccountAddress: null });
    mocks.publicProfileFor.mockImplementation(async (handle: string) => (handle === "sam" ? SAM : handle === "me" ? { userId: "user_me", handle: "me" } : null));
    mocks.threadWith.mockResolvedValue({ messages: [] });
  });

  it("reads your conversation with a real account, 404 for yourself and mock traders", async () => {
    const get = (handle: string) => GET(new Request(`http://localhost/api/messages/thread?handle=${encodeURIComponent(handle)}`));
    expect((await get("@sam")).status).toBe(200);
    expect(mocks.threadWith).toHaveBeenCalledWith("user_me", SAM);
    expect((await get("@me")).status).toBe(404);
    expect((await get("@zane_lfg")).status).toBe(404);
  });
});
