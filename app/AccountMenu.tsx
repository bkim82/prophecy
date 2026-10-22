"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignInAction, useAppAuth } from "./auth/AuthProvider";
import { ProfileIcon } from "./icons";

/**
 * Provider-neutral header account control. Provider-specific sign-in and
 * account management stay behind app/auth/AuthProvider.tsx.
 */
export function AccountMenu({ compact = false, handle = null }: { compact?: boolean; handle?: string | null }) {
  const { error, isLoaded, isSignedIn, openAccountSettings, provider, signOut, user } = useAppAuth();
  const [avatarVersion, setAvatarVersion] = useState(0);

  useEffect(() => {
    const updated = () => setAvatarVersion(Date.now());
    window.addEventListener("profile-avatar-updated", updated);
    return () => window.removeEventListener("profile-avatar-updated", updated);
  }, []);

  if (!isLoaded) {
    return <span className={compact ? "mobile-signin-avatar account-loading" : "signin-button account-loading"} aria-hidden="true" />;
  }

  if (!isSignedIn || !user) {
    return (
      <div className="account-signed-out" title={error ?? undefined}>
        <SignInAction>
          {compact ? (
            <button type="button" className="mobile-signin-avatar" aria-label="Sign in">
              <ProfileIcon className="mobile-profile-icon" />
            </button>
          ) : (
            <button type="button" className="signin-button">Sign in</button>
          )}
        </SignInAction>
      </div>
    );
  }

  const label = user.firstName ?? user.username ?? "Account";
  const initial = label.charAt(0).toUpperCase();
  return (
    <details className="account-menu">
      <summary className="account-avatar" aria-label="Open account menu">
        {initial}
        {(user.imageUrl || provider === "cdp") && (
          <span
            className="account-avatar-image"
            style={{
              backgroundImage: user.imageUrl
                ? `url(${JSON.stringify(user.imageUrl)})`
                : `url("/api/profile/avatar${avatarVersion ? `?v=${avatarVersion}` : ""}")`,
            }}
          />
        )}
      </summary>
      <div className="account-menu-popover">
        <span className="account-menu-name">{handle ? `@${handle}` : label}</span>
        <Link href="/profile"><ProfileIcon className="account-menu-icon" /> Profile</Link>
        {provider === "cdp" && <Link href="/account/security">Security</Link>}
        {openAccountSettings && (
          <button type="button" onClick={openAccountSettings}>Manage account</button>
        )}
        <button type="button" onClick={() => void signOut().catch(() => undefined)}>Sign out</button>
      </div>
    </details>
  );
}
