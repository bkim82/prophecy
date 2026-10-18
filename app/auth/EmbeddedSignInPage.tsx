"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { SignInAction, useAppAuth } from "./AuthProvider";

/**
 * /sign-in and /sign-up body in CDP mode, where Clerk's <SignIn />/<SignUp />
 * have no ClerkProvider. Opens the CDP modal once auth is ready and sends a
 * signed-in user home; the button reopens the modal if it was dismissed.
 */
export function EmbeddedSignInPage() {
  const { error, isLoaded, isSignedIn, openSignIn } = useAppAuth();
  const router = useRouter();
  const openedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      router.replace("/");
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    openSignIn();
  }, [isLoaded, isSignedIn, openSignIn, router]);

  return (
    <div className="flex flex-col items-center gap-3">
      <SignInAction>
        <button type="button" className="signin-button" disabled={!isLoaded}>Sign in</button>
      </SignInAction>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
