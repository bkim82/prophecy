"use client";

import { useRouter, usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";

const TABS = [
  { href: "/", label: "Omens" },
  { href: "/rooms", label: "Rooms" },
];

export function TabNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [underline, setUnderline] = useState<{ left: number; width: number } | null>(null);

  // "/" only matches itself; "/rooms" matches by prefix so nested room
  // routes would keep Rooms highlighted.
  const activeIndex = TABS.findIndex((tab) => (tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href)));

  useLayoutEffect(() => {
    const el = linkRefs.current[activeIndex];
    if (el) setUnderline({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeIndex, pathname]);

  return (
    <nav className="main-nav" aria-label="Primary" aria-busy={isPending}>
      {TABS.map((tab, index) => {
        const isActive = index === activeIndex;
        return (
          <a
            key={tab.href}
            ref={(el) => {
              linkRefs.current[index] = el;
            }}
            href={tab.href}
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
                router.push(tab.href);
              });
            }}
          >
            {tab.label}
          </a>
        );
      })}
      {underline && (
        <span
          className="main-nav-underline"
          style={{ transform: `translateX(${underline.left}px)`, width: underline.width }}
          aria-hidden="true"
        />
      )}
    </nav>
  );
}
