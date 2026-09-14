"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";

const TABS = [
  { href: "/", label: "Global" },
  { href: "/exclusive", label: "Exclusive" },
  { href: "/duel", label: "Duel" },
];

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <nav className="tab-nav" aria-label="Primary">
      <div className="tab-switcher" role="group" aria-busy={isPending}>
        {TABS.map((tab) => {
          // "/" only matches itself; "/duel" and "/exclusive" match by prefix
          // so nested routes (e.g. /duel/btc/match/123) keep Duel highlighted.
          const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <a
              key={tab.href}
              href={tab.href}
              className={isActive ? "active" : ""}
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
                  router.push(tab.href);
                });
              }}
            >
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
