import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getViewerProfile: vi.fn(),
  storedProfileFor: vi.fn(),
  tradeReceiptsFor: vi.fn(),
  createPost: vi.fn(),
  postCountSince: vi.fn(),
  deletePost: vi.fn(),
  votePoll: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer, getViewerProfile: mocks.getViewerProfile }));
vi.mock("@/lib/profile", () => ({ storedProfileFor: mocks.storedProfileFor }));
vi.mock("@/lib/trades", () => ({
  tradeKey: (authorId: string, ref: string) => `${authorId} ${ref}`,
  tradeReceiptsFor: mocks.tradeReceiptsFor,
}));
vi.mock("@/lib/posts", () => ({
  createPost: mocks.createPost,
  postCountSince: mocks.postCountSince,
  deletePost: mocks.deletePost,
  votePoll: mocks.votePoll,
}));

import { DELETE } from "@/app/api/posts/[id]/route";
import { POST as vote } from "@/app/api/posts/[id]/vote/route";
import { POST } from "@/app/api/posts/route";

const VIEWER = { userId: "user_1", smartAccountAddress: null };
const headers = { origin: "http://localhost", host: "localhost", "content-type": "application/json" };
const post = (body: object, extra: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/posts", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/posts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue(VIEWER);
    mocks.getViewerProfile.mockResolvedValue({ displayName: "Dana Lee" });
    mocks.storedProfileFor.mockResolvedValue(null);
    mocks.postCountSince.mockResolvedValue(0);
    mocks.tradeReceiptsFor.mockResolvedValue(new Map());
    mocks.createPost.mockResolvedValue("post_1");
  });

  it("requires sign-in", async () => {
    mocks.getViewer.mockResolvedValue(null);
    const response = await post({ content: "gm" });
    expect(response.status).toBe(401);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before reading identity", async () => {
    const response = await post({ content: "gm" }, { origin: "https://attacker.test" });
    expect(response.status).toBe(403);
    expect(mocks.getViewer).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const response = await post({ content: "x".repeat(281) });
    expect(response.status).toBe(400);
  });

  it("refuses a trade that isn't the viewer's own", async () => {
    const response = await post({ content: "look", tradeId: "portfolio:someone-elses" });
    expect(response.status).toBe(403);
    expect(mocks.tradeReceiptsFor).toHaveBeenCalledWith([{ authorId: "user_1", ref: "portfolio:someone-elses" }]);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it("rate limits fast posting", async () => {
    mocks.postCountSince.mockResolvedValueOnce(5).mockResolvedValueOnce(5);
    const response = await post({ content: "gm" });
    expect(response.status).toBe(429);
  });

  it("derives the author server-side and stores an open trade's return at post time", async () => {
    mocks.storedProfileFor.mockResolvedValue({ displayName: "Dana", handle: "dana" });
    mocks.tradeReceiptsFor.mockResolvedValue(new Map([["user_1 portfolio:p1", { id: "portfolio:p1", open: true, roiPct: 55.2 }]]));
    const response = await post({ content: "told you", tradeId: "portfolio:p1", author: "Vesper", authorId: "user_2" });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "post_1" });
    expect(mocks.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "user_1", authorName: "Dana", authorHandle: "dana", tradeRef: "portfolio:p1", tradeRoiAtPost: 55.2 }),
    );
  });

  it("doesn't store a return at post time for a closed trade", async () => {
    mocks.tradeReceiptsFor.mockResolvedValue(new Map([["user_1 arena:m1", { id: "arena:m1", open: false, roiPct: 12 }]]));
    await post({ tradeId: "arena:m1" });
    expect(mocks.createPost).toHaveBeenCalledWith(expect.objectContaining({ authorName: "Dana Lee", authorHandle: null, tradeRoiAtPost: null }));
  });
});

describe("DELETE /api/posts/[id] and POST /api/posts/[id]/vote", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue(VIEWER);
  });

  const del = () => DELETE(new Request("http://localhost/api/posts/p1", { method: "DELETE", headers, body: "{}" }), ctx("p1"));
  const voteFor = (choice: unknown) =>
    vote(new Request("http://localhost/api/posts/p1/vote", { method: "POST", headers, body: JSON.stringify({ choice }) }), ctx("p1"));

  it("deletes only the viewer's own post", async () => {
    mocks.deletePost.mockResolvedValue(false);
    expect((await del()).status).toBe(404);
    expect(mocks.deletePost).toHaveBeenCalledWith("p1", "user_1");
    mocks.deletePost.mockResolvedValue(true);
    expect((await del()).status).toBe(200);
  });

  it("requires sign-in to delete or vote", async () => {
    mocks.getViewer.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
    expect((await voteFor(0)).status).toBe(401);
  });

  it("maps vote outcomes", async () => {
    mocks.votePoll.mockResolvedValue("ok");
    expect((await voteFor(1)).status).toBe(200);
    expect(mocks.votePoll).toHaveBeenCalledWith("p1", "user_1", 1);
    expect((await voteFor("1")).status).toBe(400);
    mocks.votePoll.mockResolvedValue("closed");
    expect((await voteFor(null)).status).toBe(409);
  });
});
