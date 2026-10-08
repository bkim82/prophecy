"use client";

import { useEffect, useState } from "react";
import type { RoomId } from "@/app/lib/roomsMocks";

// Each tier's sigil, drawn in a 64×64 box centred on 32,32. It sits on the
// seam and is split between the two doors, so it breaks apart as they open.
const EMBLEMS: Record<RoomId, React.ReactNode> = {
  bronze: (
    <>
      <path d="M32 17 45 21.5V32c0 8-5.6 13.2-13 15.5C24.6 45.2 19 40 19 32V21.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 23v18M25 30h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
    </>
  ),
  silver: (
    <>
      <path d="M38 17.5a14.5 14.5 0 1 0 0 29A24 24 0 0 1 38 17.5Z" fill="currentColor" />
      <path d="m42.5 23.5 1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z" fill="currentColor" opacity=".8" />
    </>
  ),
  gold: (
    <>
      <circle cx="32" cy="32" r="7" fill="currentColor" />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d={i % 2 ? "M32 19.5V15" : "M32 21V13"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 30} 32 32)`} />
      ))}
    </>
  ),
  platinum: (
    <>
      <path d="M32 16 45.9 24v16L32 48 18.1 40V24Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 23 39.8 27.5v9L32 41 24.2 36.5v-9Z" fill="currentColor" opacity=".35" />
      <path d="M32 16v7M45.9 24l-6.1 3.5M45.9 40l-6.1-3.5M32 48v-7M18.1 40l6.1-3.5M18.1 24l6.1 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
    </>
  ),
  diamond: (
    <>
      <path d="M24 22h16l7 9-15 17-15-17Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M17 31h30M24 22l4 9 4 17 4-17 4-9M28 31l4-9 4 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity=".7" />
    </>
  ),
  prophet: (
    <>
      <path d="M32 17c4 6 10 10.5 10 18.5a10 10 0 0 1-20 0c0-4 2-7 4.5-9 .2 3 1.6 5 3.5 6-.8-6 .5-11 2-15.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 32c2 2.6 4 4.4 4 7a4 4 0 0 1-8 0c0-2.6 2-4.4 4-7Z" fill="currentColor" opacity=".8" />
    </>
  ),
  oracle: (
    <>
      <path d="M15 32s7.5-10 17-10 17 10 17 10-7.5 10-17 10-17-10-17-10Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="5.5" fill="var(--room)" />
      <circle cx="32" cy="32" r="2" fill="var(--bg)" />
    </>
  ),
};

function Seal({ tier }: { tier: RoomId }) {
  return (
    <svg className="sanctum-seal" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30.5" className="sanctum-seal-disc" />
      <g className="sanctum-seal-ring">
        <circle cx="32" cy="32" r="27.5" fill="none" stroke="currentColor" strokeWidth=".8" strokeDasharray="1.5 3.5" />
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M32 2.5 33.3 6h-2.6Z" fill="currentColor" transform={`rotate(${i * 45} 32 32)`} />
        ))}
      </g>
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="1" opacity=".5" />
      {EMBLEMS[tier]}
    </svg>
  );
}

/**
 * Entry animation for /sanctum: two heavy doors in the player's rank material,
 * set in a stone doorway and sealed with the rank's sigil, swing out toward the
 * viewer, then the view pushes through into the room. Click / Esc skips.
 * Timing lives in globals.css ("Sanctum gate"); this unmounts on the overlay's
 * own fade-out, with a timer fallback in case animations never fire.
 */
export function SanctumGate({ tier, title, subtitle }: { tier: RoomId; title: string; subtitle: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const skip = (e: KeyboardEvent) => e.key === "Escape" && setDone(true);
    const fallback = window.setTimeout(() => setDone(true), 4000);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("keydown", skip);
    };
  }, [done]);

  if (done) return null;

  return (
    <div
      className="sanctum-gate"
      data-rank={tier}
      aria-hidden="true"
      onClick={() => setDone(true)}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setDone(true);
      }}
    >
      <div className="sanctum-gate-way">
        <div className="sanctum-gate-light" />
        {(["left", "right"] as const).map((side) => (
          <div key={side} className={`sanctum-door is-${side}`}>
            <div className="sanctum-door-face">
              <Seal tier={tier} />
            </div>
            <div className="sanctum-door-edge" />
          </div>
        ))}
        <div className="sanctum-gate-caption">
          <span className="eyebrow">{subtitle}</span>
          <span className="display-font">{title}</span>
        </div>
      </div>
    </div>
  );
}
