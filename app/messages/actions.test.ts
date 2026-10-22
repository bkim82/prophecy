import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  publicProfileFor: vi.fn(),
  markThreadRead: vi.fn(),
  acceptThread: vi.fn(),
  clearThread: vi.fn(),
  messageSummaryFor: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/profile", () => ({ publicProfileFor: mocks.publicProfileFor }));
vi.mock("@/lib/messages", () => ({
  markThreadRead: mocks.markThreadRead,
  acceptThread: mocks.acceptThread,
  clearThread: mocks.clearThread,
  messageSummaryFor: mocks.messageSummaryFor,
}));

import { folderFor, messagePreview, normalizeMessage } from "@/app/lib/messageRules";
import { acceptConversation, deleteConversation, markConversationRead } from "@/app/messages/actions";

const SAM = { userId: "user_sam", handle: "sam" };
const SUMMARY = { inbox: 0, requests: 1, latest: 1 };

describe("message rules", () => {
  it("puts friends and accepted conversations in the inbox, everyone else in requests", () => {
    expect(folderFor(true, false)).toBe("inbox");
    expect(folderFor(false, true)).toBe("inbox");
    expect(folderFor(false, false)).toBe("request");
  });

  it("trims and collapses blank lines", () => {
    expect(normalizeMessage("  gm\r\n\r\n\r\n\r\nwagmi  ")).toBe("gm\n\nwagmi");
  });

  it("previews attachments when there's no text", () => {
    const message = { id: "m", body: "", mine: false, sentAt: 0, photos: [] };
    const photo = { src: "/p", width: 1, height: 1 };
    expect(messagePreview({ ...message, body: "gm" })).toBe("gm");
    expect(messagePreview({ ...message, post: null })).toBe("Shared a post");
    expect(messagePreview({ ...message, photos: [photo] })).toBe("Sent a photo");
    expect(messagePreview({ ...message, photos: [photo, photo] })).toBe("Sent 2 photos");
  });
});

describe("conversation actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue({ userId: "user_me", smartAccountAddress: null });
    mocks.publicProfileFor.mockImplementation(async (handle: string) => (handle === "sam" ? SAM : handle === "me" ? { userId: "user_me", handle: "me" } : null));
    mocks.messageSummaryFor.mockResolvedValue(SUMMARY);
  });

  it("requires sign-in", async () => {
    mocks.getViewer.mockResolvedValue(null);
    for (const result of [await markConversationRead("@sam", "m1"), await acceptConversation("@sam"), await deleteConversation("@sam")]) {
      expect(result.ok).toBe(false);
    }
    expect(mocks.markThreadRead).not.toHaveBeenCalled();
  });

  it("only works on real accounts other than you", async () => {
    for (const handle of ["@me", "@zane_lfg"]) expect((await acceptConversation(handle)).ok).toBe(false);
    expect(mocks.acceptThread).not.toHaveBeenCalled();
  });

  it("reads, accepts and deletes your side only, returning fresh counts", async () => {
    expect(await markConversationRead("@sam", "m9")).toEqual({ ok: true, summary: SUMMARY });
    expect(mocks.markThreadRead).toHaveBeenCalledWith("user_me", "user_sam", "m9");
    expect(await acceptConversation("@Sam")).toEqual({ ok: true });
    expect(mocks.acceptThread).toHaveBeenCalledWith("user_me", "user_sam");
    expect(await deleteConversation("@sam")).toEqual({ ok: true, summary: SUMMARY });
    expect(mocks.clearThread).toHaveBeenCalledWith("user_me", "user_sam");
  });
});
