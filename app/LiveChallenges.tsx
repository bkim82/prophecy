"use client";

import { useEffect } from "react";
import { goAway, heartbeat } from "@/app/lib/liveChallenges";

// Mounted once for signed-in viewers (app/layout.tsx): keeps you online
// (lib/presence.ts) and keeps the bell's challenges fresh, which is what pops
// a new challenge — or your accepted one's "Join round" — up under the bell
// (app/NotificationsMenu.tsx), plus the Messages badge (app/MessagesButton.tsx)
// and whatever the Messages dock shows. Every 2s while the tab is visible so that's
// near-instant; every 15s in the background, which still keeps you online.
// Coming back to the tab beats at once; closing it goes offline at once.
const VISIBLE_MS = 2_000;
const HIDDEN_MS = 15_000;

export function LiveChallenges() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    // Only the newest beat schedules the next, so an early beat (tab shown) never doubles the loop.
    let generation = 0;
    const beat = async () => {
      const mine = ++generation;
      clearTimeout(timer);
      await heartbeat();
      if (stopped || mine !== generation) return;
      timer = setTimeout(beat, document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS);
    };
    const back = () => {
      if (document.visibilityState === "visible") void beat();
    };
    void beat();
    window.addEventListener("pagehide", goAway);
    window.addEventListener("pageshow", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("pagehide", goAway);
      window.removeEventListener("pageshow", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return null;
}
