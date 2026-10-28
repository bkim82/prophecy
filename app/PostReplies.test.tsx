// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const publishReply = vi.hoisted(() => vi.fn());
vi.mock("@/app/auth/AuthProvider", () => ({ useAppAuth: () => ({ isSignedIn: true, openSignIn: vi.fn(), user: { firstName: "Dana" } }) }));
vi.mock("@/app/lib/engagementApi", () => ({
  publishReply,
  saveReplyLike: vi.fn(),
  editReply: vi.fn(),
  deleteReply: vi.fn(),
  loadReplies: vi.fn(),
  useSaved: (initial: boolean) => [initial, () => {}],
}));

import type { Reply } from "@/app/lib/posts";
import { ReplyBranch, threadReplies } from "@/app/PostReplies";

const reply = (id: string, parentId?: string, extra: Partial<Reply> = {}): Reply => ({
  id,
  ...(parentId ? { parentId } : {}),
  author: id.toUpperCase(),
  handle: `@${id}`,
  avatarInitial: id[0].toUpperCase(),
  content: `words ${id}`,
  timestamp: "1m",
  likes: 0,
  saved: true,
  ...extra,
});

describe("threadReplies", () => {
  it("keeps comments newest first with everything under each one oldest first", () => {
    // Newest first, as repliesFor returns them: c answers b, which answers a.
    const groups = threadReplies([reply("c", "b"), reply("z"), reply("b", "a"), reply("y", "x"), reply("a")]);
    expect(groups.map((group) => [group.comment.id, group.replies.map((r) => r.id)])).toEqual([
      ["z", []],
      ["y", []],
      ["a", ["b", "c"]],
    ]);
  });
});

describe("ReplyBranch", () => {
  afterEach(cleanup);

  it("answers a reply in a box under its comment, @mentioning its author", async () => {
    publishReply.mockResolvedValue({ ok: true, reply: reply("d", "b", { mine: true }) });
    const onPosted = vi.fn();
    render(<ReplyBranch group={{ comment: reply("a"), replies: [reply("b", "a"), reply("c", "a")] }} postId="p1" limit={1} onPosted={onPosted} onDeleted={() => {}} />);
    expect(screen.queryByText("words c")).toBeNull();
    expect(screen.getByRole("button", { name: "View 1 more reply" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[1]);
    expect(screen.getByText("words c")).toBeTruthy();
    const input = screen.getByLabelText("Reply to @b") as HTMLInputElement;
    expect(input.value).toBe("@b ");
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "@b agreed" } });
    fireEvent.submit(input.closest("form")!);
    await vi.waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(publishReply).toHaveBeenCalledWith("p1", "@b agreed", "b");
    expect(screen.queryByLabelText("Reply to @b")).toBeNull();
  });

  it("closes the box on Escape", () => {
    render(<ReplyBranch group={{ comment: reply("a"), replies: [] }} postId="p1" onPosted={() => {}} onDeleted={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.keyDown(screen.getByLabelText("Reply to @a"), { key: "Escape" });
    expect(screen.queryByLabelText("Reply to @a")).toBeNull();
  });
});
