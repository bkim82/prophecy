// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/messages/actions", () => ({
  markConversationRead: vi.fn(),
  acceptConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
vi.mock("@/app/auth/AuthProvider", () => ({
  useAppAuth: () => ({ isSignedIn: true }),
  SignInAction: ({ children }: { children: React.ReactNode }) => children,
}));

import type { ConversationView } from "@/app/lib/messageRules";
import { resetMessages, setMessageSummary, showMessages, toggleMessages } from "@/app/lib/messages";
import type { Post } from "@/app/lib/posts";
import { MessagesButton } from "@/app/MessagesButton";
import { MessagesDock } from "@/app/MessagesDock";
import { SendPostButton } from "@/app/SharePostDialog";

const conversation = (handle: string, name: string, folder: ConversationView["folder"], unread: number): ConversationView => ({
  peer: { handle, name },
  last: { id: `${handle}-1`, body: `hello from ${name}`, mine: false, sentAt: Date.now() - 120_000, photos: [] },
  unread,
  folder,
});

function serve(lists: { inbox: ConversationView[]; requests: ConversationView[] }) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(lists), { status: 200 })));
}

describe("Messages dock", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    act(() => resetMessages());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens from the header button and says when you have no messages", async () => {
    serve({ inbox: [], requests: [] });
    render(<><MessagesButton /><MessagesDock /></>);
    const button = screen.getByRole("button", { name: "Messages" });
    expect(screen.queryByRole("dialog", { name: "Messages" })).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("You have no messages")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Requests" }));
    expect(await screen.findByText("No message requests")).toBeTruthy();
  });

  it("badges unread messages and keeps friends in the inbox, strangers in requests", async () => {
    serve({ inbox: [conversation("@ben", "Ben", "inbox", 2)], requests: [conversation("@cy", "Cy", "request", 1)] });
    render(<><MessagesButton /><MessagesDock /></>);
    act(() => setMessageSummary({ inbox: 2, requests: 1, latest: 1 }));
    expect(screen.getByRole("button", { name: "Messages, 3 unread" }).textContent).toContain("3");

    act(() => toggleMessages());
    expect(await screen.findByText("hello from Ben")).toBeTruthy();
    expect(screen.queryByText("hello from Cy")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Requests/ }));
    expect(await screen.findByText("hello from Cy")).toBeTruthy();
    expect(screen.queryByText("hello from Ben")).toBeNull();
  });
});

describe("Messages dock thread", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    act(() => resetMessages());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const thread = (blocked: "by-you" | "by-them" | null) => ({
    peer: { handle: "@ben", name: "Ben" },
    folder: "inbox",
    unread: 0,
    newestUnreadId: null,
    blocked,
    messages: blocked
      ? []
      : [
          { id: "1", body: "", mine: false, sentAt: 1, photos: [{ src: "/api/messages/media/1/0", width: 4, height: 3 }] },
          { id: "2", body: "this one", mine: true, sentAt: 2, photos: [], post: { id: "g1", href: "/post/g1", author: "Vesper", handle: "@vesper", avatarInitial: "V", content: "fading this pump" } },
          { id: "3", body: "", mine: false, sentAt: 3, photos: [], post: null },
        ],
  });

  it("shows photos, shared posts and deleted posts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(thread(null)), { status: 200 })));
    render(<MessagesDock />);
    act(() => showMessages({ kind: "thread", peer: { handle: "@ben", name: "Ben" } }));
    expect(((await screen.findByAltText("Photo 1 from Ben")) as HTMLImageElement).getAttribute("src")).toBe("/api/messages/media/1/0");
    expect(screen.getByText("fading this pump").closest("a")?.getAttribute("href")).toBe("/post/g1");
    expect(screen.getByText("This post is no longer available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy();
  });

  it("swaps the composer for a notice across a block", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(thread("by-them")), { status: 200 })));
    render(<MessagesDock />);
    act(() => showMessages({ kind: "thread", peer: { handle: "@ben", name: "Ben" } }));
    expect(await screen.findByText("You can’t message @ben.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Message Ben" })).toBeNull();
  });
});

describe("Send post", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the post to the people you pick, then opens the conversation", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/messages/people")) return new Response(JSON.stringify({ people: [{ handle: "@ben", name: "Ben" }, { handle: "@cy", name: "Cy" }] }));
      if (url === "/api/messages/thread" && init?.method === "POST") return new Response(JSON.stringify({ message: { id: "m1" } }), { status: 201 });
      return new Response(JSON.stringify({ peer: { handle: "@ben", name: "Ben" }, messages: [], folder: "inbox", unread: 0, newestUnreadId: null, blocked: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    act(() => resetMessages());
    const post = { id: "g1", author: "Vesper", handle: "@vesper", avatarInitial: "V", content: "fading this pump", timestamp: "2m", likes: 0, replies: 0, kind: "text" } as Post;
    render(<><SendPostButton post={post} /><MessagesDock /></>);

    fireEvent.click(screen.getByRole("button", { name: "Send in a message" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add a message" }), { target: { value: "  thoughts?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("dialog", { name: "Messages" })).toBeTruthy();
    const sent = fetchMock.mock.calls.filter(([url, init]) => url === "/api/messages/thread" && init?.method === "POST");
    expect(sent.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{ handle: "@ben", postId: "g1", body: "thoughts?" }]);
  });
});
