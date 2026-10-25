// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/messages/actions", () => ({
  markConversationRead: vi.fn(),
  acceptConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));
const challengeMocks = vi.hoisted(() => ({ acceptChallenge: vi.fn(), declineChallenge: vi.fn(), cancelChallenge: vi.fn(), push: vi.fn() }));
vi.mock("@/app/profile/challengeActions", () => ({
  acceptChallenge: challengeMocks.acceptChallenge,
  declineChallenge: challengeMocks.declineChallenge,
  cancelChallenge: challengeMocks.cancelChallenge,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: challengeMocks.push }) }));
vi.mock("@/app/auth/AuthProvider", () => ({
  useAppAuth: () => ({ isSignedIn: true }),
  SignInAction: ({ children }: { children: React.ReactNode }) => children,
}));

import type { ConversationView } from "@/app/lib/messageRules";
import { resetMessages, setMessageSummary, showMessages, toggleMessages } from "@/app/lib/messages";
import type { Post } from "@/app/lib/mockPosts";
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

  it("shows their avatar once per group, a small break after a pause and a stamp after a long one", async () => {
    const at = (id: string, mine: boolean, minutesAgo: number) => ({ id, body: `message ${id}`, mine, sentAt: Date.now() - minutesAgo * 60_000, photos: [] });
    const messages = [at("1", false, 180), at("2", false, 179.5), at("3", true, 179), at("4", false, 60), at("5", false, 57)];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...thread(null), messages }), { status: 200 })));
    const { container } = render(<MessagesDock />);
    act(() => showMessages({ kind: "thread", peer: { handle: "@ben", name: "Ben" } }));
    await screen.findByText("message 5");
    const items = [...container.querySelectorAll(".messages-item")];
    expect(items.map((item) => item.getAttribute("data-position"))).toEqual(["first", "last", "single", "single", "single"]);
    // One avatar per run of theirs (beside its last message), none on yours.
    expect(items.map((item) => item.querySelector(".messages-bubble-avatar .messages-avatar") !== null)).toEqual([false, true, false, true, true]);
    expect(items.map((item) => item.querySelector(".messages-stamp") !== null)).toEqual([true, false, false, true, false]);
    expect(items[0].querySelector(".messages-stamp")?.textContent).toMatch(/^(Today|Yesterday) \d{1,2}:\d{2} [AP]M$/);
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

describe("challenge cards", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    act(() => resetMessages());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const terms = "Pulse · BTC · 60s round · 100 Embers";
  const openThread = (id: string, mine: boolean, status = "pending") => {
    const thread = {
      peer: { handle: "@ben", name: "Ben" },
      folder: "inbox",
      unread: 0,
      newestUnreadId: null,
      blocked: null,
      messages: [{ id: `m-${id}`, body: "", mine, sentAt: Date.now(), photos: [], challenge: { id, mode: "pulse", terms, status, expiresInMs: status === "pending" ? 95_000 : 0 } }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(thread), { status: 200 })));
    render(<MessagesDock />);
    act(() => showMessages({ kind: "thread", peer: { handle: "@ben", name: "Ben" } }));
  };

  it("lets the one challenged decline it in the conversation", async () => {
    challengeMocks.declineChallenge.mockResolvedValue({ ok: true });
    openThread("c-decline", false);
    expect(await screen.findByText("Ben challenged you")).toBeTruthy();
    expect(screen.getByText(terms)).toBeTruthy();
    expect(screen.getByText(/Answer before it expires · 1:3\d left/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined")).toBeTruthy();
    expect(challengeMocks.declineChallenge).toHaveBeenCalledWith("c-decline");
  });

  it("accepting goes into the round and closes the dock", async () => {
    challengeMocks.acceptChallenge.mockResolvedValue({ ok: true, href: "/duel/btc/pulse/m1" });
    openThread("c-accept", false);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await vi.waitFor(() => expect(challengeMocks.push).toHaveBeenCalledWith("/duel/btc/pulse/m1"));
    expect(screen.queryByRole("dialog", { name: "Messages" })).toBeNull();
  });

  it("shows the sender the wait, a cancel, and how it ended", async () => {
    challengeMocks.cancelChallenge.mockResolvedValue({ ok: true });
    openThread("c-cancel", true);
    expect(await screen.findByText("You challenged Ben")).toBeTruthy();
    expect(screen.getByText(/Waiting for Ben · 1:3\d left/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel challenge" }));
    expect(await screen.findByText("Canceled")).toBeTruthy();
    cleanup();
    openThread("c-expired", true, "expired");
    expect(await screen.findByText("Expired")).toBeTruthy();
  });
});
