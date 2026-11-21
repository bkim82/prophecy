"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArenaIcon, OmensIcon, WalletIcon } from "./icons";
import { betaModeEnabled } from "@/app/lib/betaMode";

// Sanctum is hidden from nav for now; /sanctum still works by direct URL.
const NAV_ITEMS = [
  { href: "/", label: "Omens", Icon: OmensIcon },
  { href: "/duel", label: "Arena", Icon: ArenaIcon, className: "mobile-bottom-nav-link--arena" },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon, className: "mobile-bottom-nav-link--wallet" },
];
// Beta mode: the Arena is the home page; Omens and Wallet are hidden.
const BETA_NAV_ITEMS = [{ href: "/", label: "Arena", Icon: ArenaIcon, className: "mobile-bottom-nav-link--arena" }];

function isActive(pathname: string | null, href: string) {
  // In beta mode the Arena item is "/" but /duel/* still belongs to it.
  if (href === "/") return pathname === "/" || (betaModeEnabled() && (pathname?.startsWith("/duel") ?? false));
  return pathname?.startsWith(href) ?? false;
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <div className="mobile-bottom-nav-inner">
        {(betaModeEnabled() ? BETA_NAV_ITEMS : NAV_ITEMS).map(({ href, label, Icon, className }) => {
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
