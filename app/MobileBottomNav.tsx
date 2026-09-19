"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArenaIcon, OmensIcon, ProfileIcon, RoomsIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Omens", Icon: OmensIcon },
  { href: "/rooms", label: "Rooms", Icon: RoomsIcon },
  { href: "/duel", label: "Arena", Icon: ArenaIcon, className: "mobile-bottom-nav-link--arena" },
];

function isActive(pathname: string | null, href: string) {
  if (href === "/") return pathname === "/";
  return pathname?.startsWith(href) ?? false;
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <div className="mobile-bottom-nav-inner">
        {NAV_ITEMS.map(({ href, label, Icon, className }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`mobile-bottom-nav-link${className ? ` ${className}` : ""}${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="mobile-bottom-nav-icon" />
              <span>{label}</span>
            </Link>
          );
        })}
        <div className="mobile-bottom-nav-profile">
          <Show
            when="signed-in"
            fallback={
              <SignInButton mode="modal">
                <button type="button" className="mobile-bottom-nav-account" aria-label="Sign in">
                  <ProfileIcon className="mobile-bottom-nav-icon" />
                  <span>Profile</span>
                </button>
              </SignInButton>
            }
          >
            <div className="mobile-bottom-nav-account">
              <UserButton />
              <span>Profile</span>
            </div>
          </Show>
        </div>
      </div>
    </nav>
  );
}
