// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/", checkHandle: vi.fn(), chooseHandle: vi.fn(), needsHandle: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/auth/AuthProvider", () => ({ useAppAuth: () => ({ signOut: mocks.signOut }) }));
vi.mock("@/app/profile/actions", () => ({ checkHandle: mocks.checkHandle, chooseHandle: mocks.chooseHandle, needsHandle: mocks.needsHandle }));

import { HandleGate } from "@/app/HandleGate";

describe("HandleGate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pathname = "/";
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  });
  afterEach(cleanup);

  it("asks for a handle and can't be dismissed until one is saved", async () => {
    mocks.checkHandle.mockResolvedValue({ ok: true });
    mocks.chooseHandle.mockResolvedValue({ ok: true });
    render(<HandleGate initiallyNeeded serverSignedIn />);
    const dialog = screen.getByRole("dialog", { name: "Choose your @handle" });
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);

    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "a" } });
    expect(screen.getByText("3–20 letters, numbers, _ or . (no dot at the start or end)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save handle" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@Dana" } });
    expect(await screen.findByText("@dana is yours")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save handle" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.chooseHandle).toHaveBeenCalledWith("dana");
  });

  it("stays away from people with a handle, /welcome and sign-in", () => {
    render(<HandleGate initiallyNeeded={false} serverSignedIn />);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    mocks.pathname = "/welcome";
    render(<HandleGate initiallyNeeded serverSignedIn />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("checks again after a sign-in the server didn't render", async () => {
    mocks.needsHandle.mockResolvedValue(true);
    render(<HandleGate initiallyNeeded={false} serverSignedIn={false} />);
    expect(await screen.findByRole("dialog", { name: "Choose your @handle" })).toBeTruthy();
    expect(mocks.needsHandle).toHaveBeenCalled();
  });

  it("offers a way out", () => {
    render(<HandleGate initiallyNeeded serverSignedIn />);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
