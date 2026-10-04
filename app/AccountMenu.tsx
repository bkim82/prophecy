"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ProfileIcon } from "./icons";
import { MoonIcon, SunIcon, ThemeToggle, useTheme } from "./ThemeToggle";

/**
 * Header avatar. Signed in, the theme switch lives inside Clerk's avatar menu;
 * signed out there is no menu, so the standalone toggle sits beside Sign in.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();

  return (
    <Show
      when="signed-in"
      fallback={
        <div className="account-signed-out">
          <ThemeToggle />
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
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Action
            label={theme === "dark" ? "Light mode" : "Dark mode"}
            labelIcon={theme === "dark" ? <SunIcon className="account-menu-icon" /> : <MoonIcon className="account-menu-icon" />}
            onClick={toggle}
          />
        </UserButton.MenuItems>
      </UserButton>
    </Show>
  );
}
