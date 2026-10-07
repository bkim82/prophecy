"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Scrolling down past the header tucks the phone header and bottom nav out of
// view; any scroll back up brings them back. The flag lives on <html> so the
// server-rendered header and the client bottom nav both read one attribute —
// the CSS that acts on it sits in the ≤768px block of globals.css, so desktop
// ignores it.
const ALWAYS_SHOW_ABOVE = 60;
const MIN_DELTA = 6;

export function MobileChromeAutoHide() {
  const pathname = usePathname();

  // Keyed on pathname so every navigation starts with the chrome showing.
  useEffect(() => {
    const root = document.documentElement;
    let lastY = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      // Clamp out iOS rubber-banding, which would otherwise read as a scroll
      // up at the bottom of the page and flash the chrome back in.
      const maxY = root.scrollHeight - window.innerHeight;
      const y = Math.min(Math.max(window.scrollY, 0), maxY);
      if (y <= ALWAYS_SHOW_ABOVE) {
        delete root.dataset.chrome;
        lastY = y;
        return;
      }
      if (Math.abs(y - lastY) < MIN_DELTA) return;
      if (y > lastY) root.dataset.chrome = "hidden";
      else delete root.dataset.chrome;
      lastY = y;
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      delete root.dataset.chrome;
    };
  }, [pathname]);

  return null;
}
