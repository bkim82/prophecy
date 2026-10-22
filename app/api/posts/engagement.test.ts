import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getViewerProfile: vi.fn(),
  storedProfileFor: vi.fn(),
  engagementTarget: vi.fn(),
  setLike: vi.fn(),
  setReshare: vi.fn(),
  createReply: vi.fn(),
  replyCountSince: vi.fn(),
  repliesFor: vi.fn(),
  replyExists: vi.fn(),
  setReplyLike: vi.fn(),
  editReply: vi.fn(),
  deleteReply: vi.fn(),
  voteClash: vi.fn(),
  isBlockedEitherWay: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer, getViewerProfile: mocks.getViewerProfile }));
vi.mock("@/lib/profile", () => ({ storedProfileFor: mocks.storedProfileFor }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: mocks.isBlockedEitherWay }));
vi.mock("@/lib/engagement", () => ({
  isReshareKind: (value: unknown) => value === "repost" || value === "vouch" || value === "defy",
  engagementTarget: mocks.engagementTarget,
  setLike: mocks.setLike,
  setReshare: mocks.setReshare,
  createReply: mocks.createReply,
  replyCountSince: mocks.replyCountSince,
  repliesFor: mocks.repliesFor,
  replyExists: mocks.replyExists,
  setReplyLike: mocks.setReplyLike,
  editReply: mocks.editReply,
  deleteReply: mocks.deleteReply,
  voteClash: mocks.voteClash,
}));

import { POST as voteClash } from "@/app/api/posts/[id]/clash/route";
import { POST as like } from "@/app/api/posts/[id]/like/route";
import { DELETE as deleteReply, PATCH as editReply } from "@/app/api/posts/[id]/replies/[replyId]/route";
import { POST as likeReply } from "@/app/api/posts/[id]/replies/[replyId]/like/route";
import { GET as listReplies, POST as reply } from "@/app/api/posts/[id]/replies/route";
import { POST as reshare } from "@/app/api/posts/[id]/reshare/route";

const VIEWER = { userId: "user_1", smartAccountAddress: null };
const headers = { origin: "http://localhost", host: "localhost", "content-type": "application/json" };
const request = (path: string, body: object, extra: Record<string, string> = {}) =>
  new Request(`http://localhost/api/posts/p1/${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("engagement routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue(VIEWER);
    mocks.getViewerProfile.mockResolvedValue({ displayName: "Dana Lee" });
    mocks.storedProfileFor.mockResolvedValue(null);
    mocks.engagementTarget.mockResolvedValue({ authorId: null });
    mocks.replyCountSince.mockResolvedValue(0);
    mocks.isBlockedEitherWay.mockResolvedValue(false);
  });

  it("requires sign-in and a same-origin request to like, repost or reply", async () => {
    expect((await like(request("like", { liked: true }, { origin: "https://attacker.test" }), ctx("p1"))).status).toBe(403);
    expect(mocks.getViewer).not.toHaveBeenCalled();
    mocks.getViewer.mockResolvedValue(null);
    expect((await like(request("like", { liked: true }), ctx("p1"))).status).toBe(401);
    expect((await reshare(request("reshare", { kind: "repost" }), ctx("p1"))).status).toBe(401);
    expect((await reply(request("replies", { content: "gm" }), ctx("p1"))).status).toBe(401);
    expect(mocks.setLike).not.toHaveBeenCalled();
  });

  it("likes and unlikes a post that takes engagement", async () => {
    expect((await like(request("like", { liked: true }), ctx("g-oracle1"))).status).toBe(200);
    expect(mocks.setLike).toHaveBeenCalledWith("g-oracle1", "user_1", true);
    expect((await like(request("like", { liked: "yes" }), ctx("g-oracle1"))).status).toBe(400);
    mocks.engagementTarget.mockResolvedValue(null);
    expect((await like(request("like", { liked: false }), ctx("nope"))).status).toBe(404);
    expect(mocks.setLike).toHaveBeenCalledTimes(1);
  });

  it("saves a repost with trimmed words, undoes it, and checks kind and length", async () => {
    expect((await reshare(request("reshare", { kind: "vouch", text: "  backing this  " }), ctx("p1"))).status).toBe(200);
    expect(mocks.setReshare).toHaveBeenCalledWith("p1", "user_1", { kind: "vouch", text: "backing this" });
    expect((await reshare(request("reshare", { kind: null }), ctx("p1"))).status).toBe(200);
    expect(mocks.setReshare).toHaveBeenLastCalledWith("p1", "user_1", null);
    expect((await reshare(request("reshare", { kind: "quote" }), ctx("p1"))).status).toBe(400);
    expect((await reshare(request("reshare", { kind: "repost", text: "x".repeat(281) }), ctx("p1"))).status).toBe(400);
    expect(mocks.setReshare).toHaveBeenCalledTimes(2);
  });

  it("lets authors repost their own post but not vouch for or defy it", async () => {
    mocks.engagementTarget.mockResolvedValue({ authorId: "user_1" });
    expect((await reshare(request("reshare", { kind: "defy" }), ctx("p1"))).status).toBe(403);
    expect((await reshare(request("reshare", { kind: "repost", text: "mine" }), ctx("p1"))).status).toBe(200);
    expect(mocks.setReshare).toHaveBeenCalledWith("p1", "user_1", { kind: "repost", text: "mine" });
  });

  it("refuses replies and reposts across a block with the author, but still lets you undo a repost", async () => {
    mocks.engagementTarget.mockResolvedValue({ authorId: "user_2" });
    mocks.isBlockedEitherWay.mockResolvedValue(true);
    const replied = await reply(request("replies", { content: "hi" }), ctx("p1"));
    expect(replied.status).toBe(403);
    expect(await replied.json()).toEqual({ error: "You can't reply to this post." });
    const reposted = await reshare(request("reshare", { kind: "repost" }), ctx("p1"));
    expect(reposted.status).toBe(403);
    expect(await reposted.json()).toEqual({ error: "You can't repost this post." });
    expect(mocks.isBlockedEitherWay).toHaveBeenCalledWith("user_1", "user_2");
    expect(mocks.createReply).not.toHaveBeenCalled();
    expect(mocks.setReshare).not.toHaveBeenCalled();

    expect((await reshare(request("reshare", { kind: null }), ctx("p1"))).status).toBe(200);
    expect(mocks.setReshare).toHaveBeenCalledWith("p1", "user_1", null);
  });

  it("saves a reply with a server-derived author", async () => {
    mocks.storedProfileFor.mockResolvedValue({ displayName: "Dana", handle: "dana" });
    mocks.createReply.mockResolvedValue({ id: "r1", content: "agreed" });
    const response = await reply(request("replies", { content: " agreed ", authorName: "Someone else" }), ctx("p1"));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reply: { id: "r1", content: "agreed" } });
    expect(mocks.createReply).toHaveBeenCalledWith({ postId: "p1", authorId: "user_1", authorName: "Dana", authorHandle: "dana", content: "agreed" });
  });

  it("rejects empty or long replies, unknown posts and fast replying", async () => {
    expect((await reply(request("replies", { content: "   " }), ctx("p1"))).status).toBe(400);
    expect((await reply(request("replies", { content: "x".repeat(281) }), ctx("p1"))).status).toBe(400);
    mocks.replyCountSince.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    expect((await reply(request("replies", { content: "gm" }), ctx("p1"))).status).toBe(429);
    mocks.engagementTarget.mockResolvedValue(null);
    expect((await reply(request("replies", { content: "gm" }), ctx("p1"))).status).toBe(404);
    expect(mocks.createReply).not.toHaveBeenCalled();
  });

  it("reports a reply that couldn't be saved", async () => {
    mocks.createReply.mockRejectedValue(new Error("relation does not exist"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await reply(request("replies", { content: "gm" }), ctx("p1"))).status).toBe(503);
  });

  it("lists replies as the viewer sees them", async () => {
    mocks.repliesFor.mockResolvedValue([{ id: "r1" }]);
    const response = await listReplies(new Request("http://localhost/api/posts/p1/replies"), ctx("p1"));
    expect(await response.json()).toEqual({ replies: [{ id: "r1" }] });
    expect(mocks.repliesFor).toHaveBeenCalledWith("p1", "user_1");
    mocks.engagementTarget.mockResolvedValue(null);
    expect((await listReplies(new Request("http://localhost/api/posts/x/replies"), ctx("x"))).status).toBe(404);
  });

  it("likes a reply only under its own post", async () => {
    const replyCtx = { params: Promise.resolve({ id: "p1", replyId: "r1" }) };
    mocks.replyExists.mockResolvedValue(false);
    expect((await likeReply(request("replies/r1/like", { liked: true }), replyCtx)).status).toBe(404);
    expect(mocks.replyExists).toHaveBeenCalledWith("p1", "r1");
    mocks.replyExists.mockResolvedValue(true);
    expect((await likeReply(request("replies/r1/like", { liked: true }), replyCtx)).status).toBe(200);
    expect(mocks.setReplyLike).toHaveBeenCalledWith("r1", "user_1", true);
  });

  it("edits and deletes only the viewer's own reply", async () => {
    const replyCtx = () => ({ params: Promise.resolve({ id: "p1", replyId: "r1" }) });
    const edit = (body: object) =>
      editReply(new Request("http://localhost/api/posts/p1/replies/r1", { method: "PATCH", headers, body: JSON.stringify(body) }), replyCtx());
    const remove = () => deleteReply(new Request("http://localhost/api/posts/p1/replies/r1", { method: "DELETE", headers, body: "{}" }), replyCtx());

    mocks.editReply.mockResolvedValue(true);
    const response = await edit({ content: "  better words " });
    expect(await response.json()).toEqual({ content: "better words" });
    expect(mocks.editReply).toHaveBeenCalledWith("p1", "r1", "user_1", "better words");
    expect((await edit({ content: "" })).status).toBe(400);
    mocks.editReply.mockResolvedValue(false);
    expect((await edit({ content: "not mine" })).status).toBe(404);

    mocks.deleteReply.mockResolvedValue(false);
    expect((await remove()).status).toBe(404);
    expect(mocks.deleteReply).toHaveBeenCalledWith("p1", "r1", "user_1");
    mocks.deleteReply.mockResolvedValue(true);
    expect((await remove()).status).toBe(200);

    mocks.getViewer.mockResolvedValue(null);
    expect((await edit({ content: "x" })).status).toBe(401);
    expect((await remove()).status).toBe(401);
  });

  it("saves a clash vote, takes it back, and checks the side", async () => {
    const vote = (side: unknown) => voteClash(request("clash", { side }), ctx("g-clash1"));
    mocks.voteClash.mockResolvedValue(true);
    expect((await vote(1)).status).toBe(200);
    expect(mocks.voteClash).toHaveBeenCalledWith("g-clash1", "user_1", 1);
    expect((await vote(null)).status).toBe(200);
    expect(mocks.voteClash).toHaveBeenLastCalledWith("g-clash1", "user_1", null);
    expect((await vote(2)).status).toBe(400);
    mocks.voteClash.mockResolvedValue(false);
    expect((await vote(0)).status).toBe(404);
    mocks.getViewer.mockResolvedValue(null);
    expect((await vote(0)).status).toBe(401);
  });
});
