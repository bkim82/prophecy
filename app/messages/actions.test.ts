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

import { folderFor, messagePreview, normalizeMessage, stampLabel, threadLayout } from "@/app/lib/messageRules";
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
    expect(messagePreview({ ...message, challenge: { id: "c", mode: "pulse", terms: "Pulse · BTC", status: "pending", expiresInMs: 1 } })).toBe("Challenge — Pulse · BTC");
    expect(messagePreview({ ...message, photos: [photo] })).toBe("Sent a photo");
    expect(messagePreview({ ...message, photos: [photo, photo] })).toBe("Sent 2 photos");
  });

  it("groups back-to-back messages from one side, breaking on a pause and stamping long ones", () => {
    const minute = 60_000;
    const at = (mine: boolean, minutes: number) => ({ mine, sentAt: minutes * minute });
    const layout = threadLayout([
      at(false, 0),
      at(false, 0.5),
      at(false, 1), // their group of three
      at(true, 1.5), // your turn
      at(true, 4), // a couple of minutes on: a new group
      at(true, 4.2),
      at(false, 70), // an hour later: stamped
    ]);
    expect(layout.map((slot) => slot.position)).toEqual(["first", "middle", "last", "single", "first", "last", "single"]);
    expect(layout.map((slot) => slot.stamp)).toEqual([true, false, false, false, false, false, true]);
    expect(threadLayout([])).toEqual([]);
  });

  it("labels stamps by how long ago the day was", () => {
    const now = new Date(2026, 9, 25, 18, 0).getTime(); // Sunday
    expect(stampLabel(new Date(2026, 9, 25, 15, 42).getTime(), now)).toBe("Today 3:42 PM");
    expect(stampLabel(new Date(2026, 9, 24, 23, 5).getTime(), now)).toBe("Yesterday 11:05 PM");
    expect(stampLabel(new Date(2026, 9, 20, 9, 0).getTime(), now)).toBe("Tuesday 9:00 AM");
    expect(stampLabel(new Date(2026, 9, 12, 16, 5).getTime(), now)).toBe("Mon, Oct 12 at 4:05 PM");
    expect(stampLabel(new Date(2025, 9, 12, 16, 5).getTime(), now)).toBe("Oct 12, 2025 at 4:05 PM");
    expect(stampLabel(now + 5_000, now)).toBe("Today 6:00 PM");
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
