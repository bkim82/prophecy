"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SignInAction } from "@/app/auth/AuthProvider";
import { FlameIcon, TrophyIcon } from "@/app/icons";
import { RecentResults, TopCallers, type RecentResult } from "@/app/duel/ArenaParts";
import type { TopCaller } from "@/app/lib/arenaLobby";

// Phone-only call panel for the Arena lobby (app/duel/page.tsx), shown under
// 640px in place of the desktop `.arena-call` aside: round chips, wager tiles,
// one big Battle button and a footer row, sized so the whole lobby fits one
// screen with no scrolling. Top callers / recent results (the desktop
// `.arena-bottom` row) open in a bottom sheet instead. Styles: .arena-deck-*
// and .arena-sheet in globals.css.

type Sheet = "leaders" | "results";

type Props = {
  timerPresets: { label: string; value: number }[];
  timer: number;
  onTimer: (value: number) => void;
  wagerOptions: readonly number[];
  wager: number;
  onWager: (value: number) => void;
  waiting: number;
  isSignedIn: boolean | undefined;
  /** Play is pressable (signed in, has a player id, nothing pending or live). */
  canPlay: boolean;
  pending: boolean;
  onPlay: () => void;
  practiceHref: string;
  tutorialHref: string;
  tutorialNudge: boolean;
  /** The page's "waiting for an opponent" panel; replaces the pickers and Battle while set. */
  queuePanel: ReactNode;
  note: string | null;
  leaders: TopCaller[] | null;
  results: RecentResult[] | null;
  now: number;
};

export function MobileDeck({
  timerPresets, timer, onTimer, wagerOptions, wager, onWager, waiting, isSignedIn, canPlay, pending, onPlay,
  practiceHref, tutorialHref, tutorialNudge, queuePanel, note, leaders, results, now,
}: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);

  // A native modal <dialog>: Escape, focus trapping and the backdrop for free.
  useEffect(() => {
    const dialog = sheetRef.current;
    if (!dialog) return;
    if (sheet && !dialog.open) dialog.showModal();
    if (!sheet && dialog.open) dialog.close();
  }, [sheet]);

  const battleInner = (word: string, sub?: string) => (
    <>
      <span className="arena-deck-battle-copy">
        <span className="arena-deck-battle-word">{word}</span>
        {sub && <span className="arena-deck-battle-sub">{sub}</span>}
      </span>
      <span className="arena-deck-battle-pot arena-mono">
        <span className="sr-only">Winner takes </span><FlameIcon className="arena-ember" />{wager * 2}
      </span>
    </>
  );
  const lobbyLine = `${waiting} waiting · ${timer >= 120 ? `${timer / 60} min` : `${timer}s`} round`;

  return (
    <section className="arena-deck" aria-label="Start a Pulse match">
      {queuePanel || (
        <>
          <div className="arena-deck-row">
            <span className="arena-eyebrow" id="arena-deck-timer-label">Round</span>
            <div className="arena-deck-chips" role="group" aria-labelledby="arena-deck-timer-label">
              {timerPresets.map((preset) => (
                <button key={preset.value} type="button" aria-pressed={timer === preset.value} onClick={() => onTimer(preset.value)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="arena-deck-cards" role="group" aria-label="Wager in Embers">
            {wagerOptions.map((option) => (
              <button key={option} type="button" className="arena-deck-card" aria-pressed={wager === option} onClick={() => onWager(option)}>
                <FlameIcon className="arena-deck-card-flame" />
                <strong className="arena-mono">{option}</strong>
              </button>
            ))}
          </div>

          {isSignedIn === false ? (
            <SignInAction>
              <button type="button" className="arena-deck-battle">{battleInner("Sign in")}</button>
            </SignInAction>
          ) : (
            <button type="button" className="arena-deck-battle" onClick={onPlay} disabled={!canPlay}>
              {battleInner(pending ? "Finding…" : "Battle", lobbyLine)}
            </button>
          )}
        </>
      )}

      {note && <p className="arena-muted arena-note arena-deck-note">{note}</p>}

      <div className="arena-deck-foot">
        <Link href={practiceHref} className="arena-deck-link">Practice</Link>
        {tutorialNudge && (
          <Link href={tutorialHref} className="arena-deck-link is-new">Learn Pulse</Link>
        )}
        <span className="arena-deck-foot-spacer" />
        {/* TopCallers renders nothing once loaded empty, so neither does its button. */}
        {!(leaders !== null && leaders.length === 0) && (
          <button type="button" className="arena-deck-icon" onClick={() => setSheet("leaders")} aria-label="Top callers today">
            <TrophyIcon />
          </button>
        )}
        <button type="button" className="arena-deck-icon" onClick={() => setSheet("results")} aria-label="Your recent results">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
        </button>
      </div>

      <dialog
        ref={sheetRef}
        className="arena-sheet"
        aria-label={sheet === "leaders" ? "Top callers today" : "Your recent results"}
        onClose={() => setSheet(null)}
        // A click that lands on the <dialog> itself (not its panel) is the backdrop.
        onClick={(event) => { if (event.target === event.currentTarget) setSheet(null); }}
      >
        <div className="arena-sheet-panel">
          <span className="arena-sheet-grip" aria-hidden="true" />
          {sheet === "leaders" && <TopCallers leaders={leaders} />}
          {sheet === "results" && <RecentResults isSignedIn={isSignedIn} results={results} now={now} />}
          <button type="button" className="arena-ghost-button is-quiet arena-sheet-close" onClick={() => setSheet(null)}>Close</button>
        </div>
      </dialog>
    </section>
  );
}
