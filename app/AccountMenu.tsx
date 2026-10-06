"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ProfileIcon } from "./icons";

/**
 * Header avatar: Clerk's menu when signed in (with a Profile link to the
 * viewer's own /profile ahead of Clerk's defaults), Sign in otherwise. The
 * theme picker sits beside it in the header (app/ThemeToggle.tsx).
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  return (
    <Show
      when="signed-in"
      fallback={
        <div className="account-signed-out">
          <SignInButton mode="modal">
            {compact ? (
              <button type="button" className="mobile-signin-avatar" aria-label="Sign in">
                <ProfileIcon className="mobile-profile-icon" />
              </button>
            ) : (
              <button type="button" className="signin-button">Sign in</button>
            )}
          </SignInButton>
        </div>
      }
    >
      <UserButton
        appearance={{
          elements: {
            userButtonBox: "account-user-button-box",
            userButtonTrigger: "account-user-button-trigger",
            avatarBox: "account-avatar-box",
          },
        }}
      >
        <UserButton.MenuItems>
          <UserButton.Link label="Profile" labelIcon={<ProfileIcon className="account-menu-icon" />} href="/profile" />
          <UserButton.Action label="manageAccount" />
        </UserButton.MenuItems>
      </UserButton>
    </Show>
  );
}
