"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArenaIcon, OmensIcon, RoomsIcon, WalletIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "Omens", Icon: OmensIcon },
  { href: "/rooms", label: "Rooms", Icon: RoomsIcon },
  { href: "/duel", label: "Arena", Icon: ArenaIcon, className: "mobile-bottom-nav-link--arena" },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon, className: "mobile-bottom-nav-link--wallet" },
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
      </div>
    </nav>
  );
}
