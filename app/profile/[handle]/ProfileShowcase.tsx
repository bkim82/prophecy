"use client";

import { useEffect, useRef, useState } from "react";
import { ProfileIcon, SparkleIcon, TrophyIcon } from "@/app/icons";

// The profile hero as a card with faces. ≤768px, where the rail
// (ProfileAchievements) is hidden, a top-left button lets you flip the card
// to Achievements or the Highlight reel. The button names the face it's on
// and carries one dot per face, so the other views are discoverable before
// it's ever tapped. Picking one spins the card edge-on ("out"), swaps
// faces, then spins back ("in"); data-flip drives the CSS. Every face shares
// one grid cell, so the card keeps the tallest face's height and the page
// below doesn't jump. Above 768px only the profile face shows.

// Server-rendered panels, passed down so the rail's components are reused as-is.
export type ShowcasePanels = { achievements: React.ReactNode; reel?: React.ReactNode };

type Face = "profile" | "achievements" | "reel";

const FACES: { id: Face; label: string; Icon: (props: { className?: string }) => React.JSX.Element }[] = [
  { id: "profile", label: "Profile", Icon: ProfileIcon },
  { id: "achievements", label: "Achievements", Icon: TrophyIcon },
  { id: "reel", label: "Highlight reel", Icon: SparkleIcon },
];

type ProfileShowcaseProps = {
  className: string;
  rank?: string;
  // Absent → a plain hero with no face menu.
  panels?: ShowcasePanels;
  // The profile face (avatar, name, stats, actions).
  children: React.ReactNode;
};

export function ProfileShowcase({ className, rank, panels, children }: ProfileShowcaseProps) {
  const [face, setFace] = useState<Face>("profile");
  const [flip, setFlip] = useState<{ phase: "out" | "in"; next: Face } | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const faces = FACES.filter((option) => option.id !== "reel" || panels?.reel);
  const current = FACES.find((option) => option.id === face) ?? FACES[0];
  const others = faces.filter((option) => option.id !== face).map((option) => option.label);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: Face) => {
    setOpen(false);
    if (next === face || flip) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setFace(next);
    else setFlip({ phase: "out", next });
  };

  // Children's animations (badges, the glint, card reveals) bubble here too —
  // only the card's own spin advances the flip.
  const onAnimationEnd = (event: React.AnimationEvent<HTMLElement>) => {
    if (!flip || event.target !== event.currentTarget) return;
    if (flip.phase === "out" && event.animationName === "profile-flip-out") {
      setFace(flip.next);
      setFlip({ phase: "in", next: flip.next });
    } else if (flip.phase === "in" && event.animationName === "profile-flip-in") {
      setFlip(null);
    }
  };

  return (
    <section className={`${className} profile-showcase${panels ? " has-faces" : ""}`} data-rank={rank} data-showing={face} data-flip={flip?.phase} onAnimationEnd={onAnimationEnd}>
      {panels && (
        <div ref={menuRef} className="profile-face-menu">
          <button
            type="button"
            className="profile-face-toggle"
            aria-label={`${current.label} — switch to ${others.join(" or ")}`}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={flip !== null}
            onClick={() => setOpen((value) => !value)}
          >
            <current.Icon />
            <span className="profile-face-label">{current.label}</span>
            <span className="profile-face-dots" aria-hidden="true">
              {faces.map((option) => (
                <span key={option.id} className={option.id === face ? "is-active" : undefined} />
              ))}
            </span>
          </button>
          {open && (
            <div className="theme-menu-popover profile-face-popover" role="menu" aria-label="Profile view">
              {faces.map(({ id, label, Icon }) => (
                <button key={id} type="button" role="menuitemradio" aria-checked={id === face} onClick={() => choose(id)}>
                  <Icon />
                  <strong>{label}</strong>
                  {id === face && (
                    <span className="theme-menu-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="profile-face" data-face="profile">
        {children}
      </div>
      {panels && (
        <>
          <div className="profile-face profile-face--panel" data-face="achievements">
            {panels.achievements}
          </div>
          {panels.reel && (
            <div className="profile-face profile-face--panel" data-face="reel">
              {panels.reel}
            </div>
          )}
        </>
      )}
    </section>
  );
}
