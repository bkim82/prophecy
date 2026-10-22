// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/auth/AuthProvider", () => ({ useAppAuth: () => ({ isSignedIn: true, openSignIn: vi.fn(), user: { firstName: "Dana" } }) }));

import type { Post } from "@/app/lib/mockPosts";
import { ReplyComposer } from "@/app/PostReplies";
import { RepostMenu } from "@/app/RepostMenu";

const post = { id: "p1", author: "Ben", handle: "@ben", avatarInitial: "B", content: "call", timestamp: "2m", likes: 0, replies: 0, kind: "text", saved: true } as Post;
const composer = (blocked: boolean) => (
  <ReplyComposer postId="p1" replyingTo="@ben" inputRef={createRef()} draft="" onDraft={() => {}} onPosted={() => {}} blocked={blocked} />
);

describe("a post across a block", () => {
  afterEach(cleanup);

  it("swaps the reply box for a note", () => {
    render(composer(true));
    expect(screen.getByText("You can’t reply to this post.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Post your reply")).toBeNull();
    cleanup();
    render(composer(false));
    expect(screen.getByPlaceholderText("Post your reply")).toBeTruthy();
  });

  it("disables Repost unless there's a repost to undo", () => {
    render(<RepostMenu post={{ ...post, blocked: true }} mine={false} reshare={null} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: /^Repost/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<RepostMenu post={{ ...post, blocked: true }} mine={false} reshare={{ kind: "repost", text: "" }} onChange={() => {}} />);
    expect((screen.getByRole("button", { name: /^Reposted/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
