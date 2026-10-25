"use client";

import { useRouter, usePathname } from "next/navigation";
import { useOptimistic, useTransition } from "react";

// Same destinations, same order, as MobileBottomNav (text only here). Sanctum
// is hidden from nav for now; /sanctum still works by direct URL.
const TABS = [
  { href: "/", label: "Omens" },
  { href: "/duel", label: "Arena" },
  { href: "/wallet", label: "Wallet" },
];

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // A click moves the underline to its tab at once instead of after the route
  // loads; it falls back to the real pathname when the transition settles.
  const [activePath, setActivePath] = useOptimistic(pathname);

  // "/" only matches itself; the rest match by prefix so nested routes
  // (/duel/portfolio, /duel/btc/pulse/…) keep their section highlighted.
  const activeIndex = TABS.findIndex((tab) => (tab.href === "/" ? activePath === "/" : activePath.startsWith(tab.href)));

  return (
    <nav className="main-nav" aria-label="Primary" aria-busy={isPending}>
      {TABS.map(({ href, label }, index) => {
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
