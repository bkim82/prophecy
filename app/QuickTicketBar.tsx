"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletDesk } from "./WalletDesk";
import {
  getActiveMatch,
  isQueueing,
  subscribeActiveMatch,
  subscribeQueueing,
  type ActiveMatch,
} from "./lib/activeMatch";

/**
 * The idle-state counterpart to ActiveMatchBar. It lives in the same global
 * bottom slot, but yields whenever the player has a match to return to.
 */
export function QuickTicketBar() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [queueing, setQueueing] = useState(false);

  useEffect(() => {
    setActiveMatch(getActiveMatch());
    return subscribeActiveMatch(() => setActiveMatch(getActiveMatch()));
  }, []);

  useEffect(() => {
    setQueueing(isQueueing());
    return subscribeQueueing(() => setQueueing(isQueueing()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const inGame = pathname?.startsWith("/duel/") ?? false;
  if (activeMatch || queueing || inGame) return null;

  return (
    <div
      ref={containerRef}
      className="quick-ticket-bar"
    >
      {open && (
        <div id="quick-ticket-popover" className="quick-ticket-popover" role="dialog" aria-label="Quick ticket">
          <WalletDesk showConnection={false} showHoldings={false} />
        </div>
      )}
      <button
        type="button"
        className="quick-ticket-tab"
        aria-expanded={open}
        aria-controls="quick-ticket-popover"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="quick-ticket-tab-mark" aria-hidden="true">+</span>
        <span>Quick ticket</span>
        <span className="quick-ticket-tab-chevron" aria-hidden="true">⌃</span>
      </button>
    </div>
  );
}
