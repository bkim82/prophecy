"use client";

import { SignInButton } from "@clerk/nextjs";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArenaIcon, LockIcon, PatientIcon, SwiftIcon } from "@/app/icons";
import {
  CHALLENGE_MODES,
  CHALLENGE_STAKES,
  PULSE_MARKETS,
  PULSE_ROUNDS,
  challengeTerms,
  type ChallengeMode,
} from "@/app/lib/challengeRules";
import { cancelChallenge, sendChallenge } from "@/app/profile/challengeActions";
import { RankBadge } from "@/app/RankBadge";

// The Challenge button on someone else's profile, secondary to Follow in
// the hero, and the dialog it opens. The page works out which state applies
// (app/profile/[handle]/page.tsx); the server action re-checks all of it.

export type ChallengeState =
  | { kind: "signed-out" }
  // The one-tier-up gate (app/lib/rank.ts canChallenge) says no.
  | { kind: "locked"; tierNeeded: string }
  | { kind: "ready" }
  | { kind: "pending"; id: string; terms: string };

type ChallengeTarget = { handle: string; name: string; rank: string };

type ChallengeControlProps = {
  state: ChallengeState;
  target: ChallengeTarget;
  viewerRank: string;
  // The Follow button, kept on the same row.
  children: React.ReactNode;
};

export function ChallengeControl({ state, target, viewerRank, children }: ChallengeControlProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();

  const label = (
    <>
      <ArenaIcon />
      Challenge
    </>
  );

  let button: React.ReactNode;
  let note: React.ReactNode = null;
  if (state.kind === "signed-out") {
    button = (
      <SignInButton mode="modal">
        <button type="button" className="profile-challenge-button">
          {label}
        </button>
      </SignInButton>
    );
  } else if (state.kind === "locked") {
    button = (
      <button type="button" className="profile-challenge-button is-locked" disabled aria-describedby={noteId}>
        <LockIcon />
        Challenge
      </button>
    );
    note = (
      <>
        Reach <strong>{state.tierNeeded}</strong> to challenge {target.name} — you&rsquo;re <RankBadge rank={viewerRank} seed="viewer" />.
      </>
    );
  } else if (state.kind === "pending") {
    button = (
      <span className="profile-challenge-button is-pending" aria-describedby={noteId}>
        <ArenaIcon />
        Challenge sent
      </span>
    );
    note = (
      <>
        {state.terms} · waiting on {target.name}.{" "}
        <button
          type="button"
          className="profile-edit-text-button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelChallenge(state.id).catch(() => ({ ok: false as const, error: "Couldn't cancel — try again." }));
              setError(result.ok ? null : result.error);
            })
          }
        >
          {pending ? "Canceling…" : "Cancel challenge"}
        </button>
      </>
    );
  } else {
    button = (
      <button type="button" className="profile-challenge-button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <>
      {/* Follow (primary) first, then Challenge. */}
      <div className="profile-actions">
        {children}
        {button}
      </div>
      {note && (
        <p id={noteId} className="profile-challenge-note muted">
          {note}
        </p>
      )}
      {error && (
        <p className="profile-edit-error" role="alert">
          {error}
        </p>
      )}
      {open && <ChallengeDialog target={target} viewerRank={viewerRank} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChallengeDialog({ target, viewerRank, onClose }: { target: ChallengeTarget; viewerRank: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [mode, setMode] = useState<ChallengeMode>("pulse");
  const [market, setMarket] = useState<string>(PULSE_MARKETS[0].id);
  const [timerSeconds, setTimerSeconds] = useState(PULSE_ROUNDS[0]);
  const [stake, setStake] = useState(CHALLENGE_STAKES.pulse[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const pickMode = (next: ChallengeMode) => {
    setMode(next);
    // Each mode has its own stake presets; keep the stake if it's offered in both.
    if (!CHALLENGE_STAKES[next].includes(stake)) setStake(CHALLENGE_STAKES[next][0]);
  };

  function send() {
    startTransition(async () => {
      setError(null);
      try {
        const result = await sendChallenge(
          mode === "pulse" ? { handle: target.handle, mode, market, timerSeconds, stake } : { handle: target.handle, mode, stake },
        );
        if (!result.ok) return setError(result.error);
      } catch {
        return setError("Couldn't send the challenge — try again.");
      }
      dialogRef.current?.close();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="profile-edit profile-challenge-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => pending && event.preventDefault()}
    >
      <form
        className="profile-edit-panel"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <header className="profile-edit-head">
          <h2 id={`${id}-title`}>Challenge {target.name}</h2>
          <button type="button" className="profile-edit-close" aria-label="Close" disabled={pending} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>

        <div className="profile-edit-body">
          <p className="challenge-versus">
            <RankBadge rank={viewerRank} seed="viewer" />
            <span className="muted">vs</span>
            <RankBadge rank={target.rank} seed={target.handle} />
            <span className="muted">{target.handle}</span>
          </p>

          <fieldset className="challenge-group">
            <legend>Match</legend>
            <div className="challenge-modes">
              {(Object.keys(CHALLENGE_MODES) as ChallengeMode[]).map((option) => {
                const Icon = option === "pulse" ? SwiftIcon : PatientIcon;
                return (
                  <button key={option} type="button" className="challenge-mode" aria-pressed={mode === option} onClick={() => pickMode(option)}>
                    <Icon />
                    <strong>{CHALLENGE_MODES[option].label}</strong>
                    <span className="muted">{CHALLENGE_MODES[option].blurb}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {mode === "pulse" && (
            <div className="challenge-row">
              <fieldset className="challenge-group">
                <legend>Market</legend>
                <div className="challenge-options">
                  {PULSE_MARKETS.map((option) => (
                    <button key={option.id} type="button" aria-pressed={market === option.id} onClick={() => setMarket(option.id)}>
                      <span className={`market-symbol ${option.symbolClass}`} aria-hidden="true">
                        {option.symbol}
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="challenge-group">
                <legend>Round</legend>
                <div className="challenge-options">
                  {PULSE_ROUNDS.map((seconds) => (
                    <button key={seconds} type="button" aria-pressed={timerSeconds === seconds} onClick={() => setTimerSeconds(seconds)}>
                      {seconds}s
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          <fieldset className="challenge-group">
            <legend>Stake</legend>
            <div className="challenge-options">
              {CHALLENGE_STAKES[mode].map((amount) => (
                <button key={amount} type="button" aria-pressed={stake === amount} onClick={() => setStake(amount)}>
                  {amount.toLocaleString("en-US")} Embers
                </button>
              ))}
            </div>
          </fieldset>

          <p className="challenge-summary">
            <strong>{challengeTerms({ mode, market: mode === "pulse" ? market : null, timerSeconds: mode === "pulse" ? timerSeconds : null, stake })}</strong>
            <span className="muted">Embers aren&rsquo;t reserved until {target.name} accepts.</span>
          </p>

          {error && (
            <p className="profile-edit-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="profile-edit-foot">
          <div className="profile-edit-buttons">
            <button type="button" className="profile-follow is-following" disabled={pending} onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="profile-challenge-button" disabled={pending}>
              <ArenaIcon />
              {pending ? "Sending…" : "Send challenge"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
