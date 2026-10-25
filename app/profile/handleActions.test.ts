import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  handleFor: vi.fn(),
  handleOwner: vi.fn(),
  saveStoredProfile: vi.fn(),
  refresh: vi.fn(),
  followTarget: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/profile", () => ({
  handleFor: mocks.handleFor,
  handleOwner: mocks.handleOwner,
  saveStoredProfile: mocks.saveStoredProfile,
  savePinnedMatches: vi.fn(),
  storedProfileFor: vi.fn(),
  rankForUser: vi.fn(),
}));
vi.mock("@/lib/follows", () => ({ followTarget: mocks.followTarget, saveFollow: vi.fn(), isFollowing: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: vi.fn(), saveBlock: vi.fn() }));
vi.mock("@/lib/match", () => ({ historyEntryFor: vi.fn(), settledMatchesByIds: vi.fn() }));
vi.mock("@/lib/balance", () => ({ ensureUser: vi.fn(), refundBalance: vi.fn(), reserveBalance: vi.fn() }));
vi.mock("@/lib/challenges", () => ({}));
vi.mock("@/lib/messages", () => ({ saveMessage: vi.fn() }));
vi.mock("@/lib/presence", () => ({ isOnline: vi.fn(), touchPresence: vi.fn() }));

import { chooseHandle, needsHandle, saveProfile } from "@/app/profile/actions";
import { sendChallenge } from "@/app/profile/challengeActions";

describe("required handles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getViewer.mockResolvedValue({ userId: "user_1", smartAccountAddress: null });
    mocks.saveStoredProfile.mockResolvedValue("ok");
  });

  it("knows who still needs one", async () => {
    mocks.handleFor.mockResolvedValue(null);
    expect(await needsHandle()).toBe(true);
    mocks.handleFor.mockResolvedValue("dana");
    expect(await needsHandle()).toBe(false);
    mocks.getViewer.mockResolvedValue(null);
    expect(await needsHandle()).toBe(false);
  });

  it("saves just the handle, normalized, by Edit profile's rules", async () => {
    expect(await chooseHandle("  @Dana_Trades ")).toEqual({ ok: true });
    expect(mocks.saveStoredProfile).toHaveBeenCalledWith("user_1", { handle: "dana_trades" }, { kind: "keep" });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("rejects blank, malformed, reserved and taken handles", async () => {
    expect(await chooseHandle("   ")).toEqual({ ok: false, field: "handle", error: "Pick a handle." });
    expect((await chooseHandle("a")).ok).toBe(false);
    expect(await chooseHandle("admin")).toEqual({ ok: false, field: "handle", error: "That handle is taken." });
    expect(mocks.saveStoredProfile).not.toHaveBeenCalled();
    mocks.saveStoredProfile.mockResolvedValue("handle-taken");
    expect(await chooseHandle("dana")).toEqual({ ok: false, field: "handle", error: "That handle is taken." });
    mocks.getViewer.mockResolvedValue(null);
    expect((await chooseHandle("dana")).ok).toBe(false);
  });

  it("won't let Edit profile clear it", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ displayName: "Dana", handle: "", bio: "", location: "", website: "", banner: "keep", avatar: "keep" })) form.set(key, value);
    expect(await saveProfile(form)).toEqual({ ok: false, field: "handle", error: "Pick a handle." });
    expect(mocks.saveStoredProfile).not.toHaveBeenCalled();
  });

  it("needs one to send a challenge", async () => {
    mocks.handleFor.mockResolvedValue(null);
    expect(await sendChallenge({ handle: "@sam", market: "btc", timerSeconds: 60, stake: 0 })).toEqual({ ok: false, error: "Choose your @handle before sending challenges." });
    expect(mocks.followTarget).not.toHaveBeenCalled();
  });
});
