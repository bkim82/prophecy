"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { PROFILE_LIMITS, handleProblem, normalizeHandle } from "@/app/lib/profileEdit";
import { checkHandle, chooseHandle, needsHandle } from "@/app/profile/actions";

// Every account needs an @handle — it's how people find, follow, message and
// challenge you. Signed in without one, this prompt sits over every page
// (mounted by app/layout.tsx) and can't be dismissed until you pick one, or
// sign out. /welcome asks for it in its own first step and the sign-in pages
// are left alone. `initiallyNeeded` is what the server saw rendering the
// layout; a sign-in it didn't see (the provider's modal doesn't re-render the
// layout) asks again with needsHandle.

const EXEMPT = ["/welcome", "/sign-in", "/sign-up"];

export function HandleGate({ initiallyNeeded, serverSignedIn }: { initiallyNeeded: boolean; serverSignedIn: boolean }) {
  const pathname = usePathname();
  const [needed, setNeeded] = useState(initiallyNeeded);

  useEffect(() => {
    if (serverSignedIn) return;
    let live = true;
    needsHandle().then(
      (next) => {
        if (live) setNeeded(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [serverSignedIn]);

  if (!needed || EXEMPT.some((path) => pathname.startsWith(path))) return null;
  return <HandlePrompt onDone={() => setNeeded(false)} />;
}

function HandlePrompt({ onDone }: { onDone: () => void }) {
  const { signOut } = useAppAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [value, setValue] = useState("");
  const [check, setCheck] = useState<{ handle: string; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handle = normalizeHandle(value);
  const issue = handle ? handleProblem(handle) : null;
  // Same live hint as /welcome: a pause in typing asks whether it's free (the save re-checks).
  useEffect(() => {
    if (!handle || issue) return;
    let live = true;
    const timer = setTimeout(() => {
      checkHandle(handle).then(
        (result) => {
          if (live) setCheck({ handle, error: result.ok ? null : result.error });
        },
        () => {},
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [handle, issue]);
  const checked = check?.handle === handle ? check : null;
  const shownError = error ?? issue ?? checked?.error ?? null;
  const hint = !handle ? "3–20 letters, numbers, _ or ." : checked ? `@${handle} is yours` : "Checking…";

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await chooseHandle(handle).catch(() => ({ ok: false as const, error: "Couldn't save your handle — try again." }));
      if (!result.ok) return setError(result.error);
      dialogRef.current?.close();
      onDone();
    });

  return (
    <dialog ref={dialogRef} className="profile-edit handle-gate" aria-labelledby={`${id}-title`} onCancel={(event) => event.preventDefault()}>
      <form
        className="profile-edit-panel"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <header className="profile-edit-head">
          <h2 id={`${id}-title`}>Choose your @handle</h2>
        </header>
        <div className="profile-edit-body">
          <p className="handle-gate-lead muted">
            Your handle is how traders find, follow, message and challenge you. Every account needs one — you can change it later in Edit profile.
          </p>
          <div className={`profile-edit-field${shownError ? " has-error" : ""}`}>
            <div className="profile-edit-label">
              <label htmlFor={`${id}-handle`}>Handle</label>
            </div>
            <span className="profile-edit-prefixed">
              <span aria-hidden="true">@</span>
              <input
                id={`${id}-handle`}
                value={value}
                maxLength={PROFILE_LIMITS.handle + 1}
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                required
                autoFocus
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              />
            </span>
            <p className={shownError ? "profile-edit-error" : `profile-edit-hint${checked && !checked.error ? " welcome-hint-ok" : " muted"}`} aria-live="polite">
              {shownError ?? hint}
            </p>
          </div>
        </div>
        <footer className="profile-edit-foot">
          <button type="button" className="profile-edit-text-button" disabled={pending} onClick={() => void signOut()}>
            Sign out
          </button>
          <div className="profile-edit-buttons">
            <button type="submit" className="profile-follow" disabled={pending || !handle || Boolean(issue) || Boolean(checked?.error)}>
              {pending ? "Saving…" : "Save handle"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
