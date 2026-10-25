"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";

// Reports omens the viewer has seen in a feed (POST /api/posts/seen), so For
// You leaves them out on the next load (lib/postViews.ts). A post counts as
// seen once half of it (or half the screen's worth of a tall one) has stayed
// on screen for 5 seconds while the tab is visible — a glance on the way to
// somewhere else doesn't count. Signed in only; fire-and-forget, batched.

const DWELL_MS = 5000;
const FLUSH_MS = 3000;
const MAX_BATCH = 50;
// Fine steps, so a card several screens tall still gets a callback once half
// a screen of it is up.
const THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);

function onScreen(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  const viewport = entry.rootBounds?.height ?? window.innerHeight;
  return entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= viewport / 2;
}

// Watches the post cards directly inside `list` (not posts embedded in a
// repost). `rowsKey` changes whenever the rendered rows do, so new cards get
// watched too. `known` = ids the server already has as seen; never re-sent.
export function useSeenPostTracker(list: RefObject<HTMLElement | null>, rowsKey: unknown, known: ReadonlySet<string>) {
  const { isSignedIn } = useAppAuth();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    const reported = new Set<string>();
    const queue = new Set<string>();
    // Cards on screen right now, so their clocks restart when a hidden tab comes back.
    const visible = new Set<Element>();
    const dwell = new Map<Element, number>();
    let flushTimer: number | undefined;
    let stopped = false;

    const idOf = (card: Element) => card.id.slice("post-".length);

    const stopDwell = (card: Element) => {
      window.clearTimeout(dwell.get(card));
      dwell.delete(card);
    };

    const startDwell = (card: Element) => {
      const id = idOf(card);
      if (stopped || !card.isConnected || document.visibilityState !== "visible") return;
      if (dwell.has(card) || reported.has(id) || known.has(id)) return;
      dwell.set(
        card,
        window.setTimeout(() => {
          dwell.delete(card);
          if (!card.isConnected) return;
          reported.add(id);
          queue.add(id);
          flushTimer ??= window.setTimeout(flush, FLUSH_MS);
        }, DWELL_MS),
      );
    };

    // Signed out elsewhere, or db/post-views.sql isn't applied yet: stop
    // reporting for the rest of this page view.
    const stop = () => {
      stopped = true;
      observerRef.current = null;
      observer.disconnect();
      dwell.forEach((timer) => window.clearTimeout(timer));
      dwell.clear();
      visible.clear();
      queue.clear();
      window.clearTimeout(flushTimer);
    };

    const flush = () => {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
      while (queue.size > 0) {
        const ids = [...queue].slice(0, MAX_BATCH);
        ids.forEach((id) => queue.delete(id));
        void fetch("/api/posts/seen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
          keepalive: true,
        })
          .then((response) => {
            if (response.status === 401 || response.status === 503) stop();
          })
          .catch(() => {});
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const { target } = entry;
          if (onScreen(entry)) {
            visible.add(target);
            startDwell(target);
          } else {
            visible.delete(target);
            stopDwell(target);
          }
        }
      },
      { threshold: THRESHOLDS },
    );
    observerRef.current = observer;

    // A hidden tab isn't being read: pause every clock, and start them over
    // for whatever's on screen when it's back.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        dwell.forEach((timer) => window.clearTimeout(timer));
        dwell.clear();
        flush();
      } else {
        visible.forEach(startDwell);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      observerRef.current = null;
      observer.disconnect();
      dwell.forEach((timer) => window.clearTimeout(timer));
      flush();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [isSignedIn, known]);

  useEffect(() => {
    const observer = observerRef.current;
    const root = list.current;
    if (!observer || !root) return;
    // Observing a card that's already watched is a no-op.
    root.querySelectorAll(':scope > article[id^="post-"]').forEach((card) => observer.observe(card));
  }, [isSignedIn, known, rowsKey, list]);
}
