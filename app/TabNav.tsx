"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ArenaIcon, OmensIcon, SanctumIcon, WalletIcon } from "./icons";

// Same four destinations, same order, as MobileBottomNav.
const TABS = [
  { href: "/", label: "Omens", Icon: OmensIcon },
  { href: "/duel", label: "Arena", Icon: ArenaIcon },
  { href: "/sanctum", label: "Sanctum", Icon: SanctumIcon },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon },
];

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // "/" only matches itself; the rest match by prefix so nested routes
  // (/duel/portfolio, /duel/btc/pulse/…) keep their section highlighted.
  const activeIndex = TABS.findIndex((tab) => (tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)));

  return (
    <nav className="main-nav" aria-label="Primary" aria-busy={isPending}>
      {TABS.map(({ href, label, Icon }, index) => {
        const isActive = index === activeIndex;
        return (
          <a
            key={href}
            href={href}
            className={`main-nav-link${isActive ? " active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onClick={(event) => {
              // A plain <Link> click doesn't cancel an in-flight
              // navigation, so a burst of fast clicks can leave the router
              // stuck mid-transition until reload. Driving router.push
              // through startTransition means each new click supersedes
              // whatever transition was still pending, instead of queuing
              // behind it.
              event.preventDefault();
              startTransition(() => {
                router.push(href);
              });
            }}
          >
            <Icon className="main-nav-icon" />
            {label}
          </a>
        );
      })}
    </nav>
  );
}
