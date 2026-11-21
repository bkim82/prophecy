"use client";

import { useRouter, usePathname } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { betaModeEnabled } from "@/app/lib/betaMode";

// Same destinations, same order, as MobileBottomNav (text only here). Sanctum
// is hidden from nav for now; /sanctum still works by direct URL.
const TABS = [
  { href: "/", label: "Omens" },
  { href: "/duel", label: "Arena" },
  { href: "/wallet", label: "Wallet" },
];
// Beta mode: the Arena is the home page; Omens and Wallet are hidden.
const BETA_TABS = [{ href: "/", label: "Arena" }];

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // A click moves the underline to its tab at once instead of after the route
  // loads; it falls back to the real pathname when the transition settles.
  const [activePath, setActivePath] = useOptimistic(pathname);

  // "/" only matches itself; the rest match by prefix so nested routes
  // (/duel/portfolio, /duel/btc/pulse/…) keep their section highlighted.
  // In beta mode the Arena tab is "/" but /duel/* still belongs to it.
  const beta = betaModeEnabled();
  const tabs = beta ? BETA_TABS : TABS;
  const activeIndex = beta
    ? activePath === "/" || activePath.startsWith("/duel") ? 0 : -1
    : TABS.findIndex((tab) => (tab.href === "/" ? activePath === "/" : activePath.startsWith(tab.href)));

  return (
    <nav className="main-nav" aria-label="Primary" aria-busy={isPending}>
      {tabs.map(({ href, label }, index) => {
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
                setActivePath(href);
                router.push(href);
              });
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
