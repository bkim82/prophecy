"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { SignInAction } from "@/app/auth/AuthProvider";
import { ArenaIcon, LockIcon, SwiftIcon } from "@/app/icons";
import {
  CHALLENGE_STAKES,
  CHALLENGE_TTL_SECONDS,
  NO_STAKE,
  PULSE_BLURB,
  PULSE_MARKETS,
  PULSE_ROUNDS,
  challengeTerms,
  stakeLabel,
} from "@/app/lib/challengeRules";
import { cancelChallenge, sendChallenge } from "@/app/profile/challengeActions";
import { RankBadge } from "@/app/RankBadge";

// The Challenge button on someone else's profile, secondary to Follow in
// the hero, and the dialog it opens. Challenges are friends-only — you follow
// each other, from the hero's Follow toggle plus their follow of you (mock
// traders never follow back) — and live: you both have to be online.
// The page works out the rest of the state (app/profile/[handle]/page.tsx);
// the server action re-checks all of it.

export type ChallengeState =
  | { kind: "signed-out" }
  // The one-tier-up gate (app/lib/rank.ts canChallenge) says no.
  | { kind: "locked"; tierNeeded: string }
  | { kind: "ready" }
  // `expiresInMs` as measured by the server when it rendered the page.
  | { kind: "pending"; id: string; terms: string; expiresInMs: number };

type ChallengeTarget = { handle: string; name: string; rank: string };

type ChallengeControlProps = {
  state: ChallengeState;
  target: ChallengeTarget;
  viewerRank: string;
  // You follow them (the Follow button's current state) / they follow you.
  following: boolean;
  followsYou: boolean;
  // They're online right now (ProfileView polls it); you are, being here.
  online: boolean;
  // The Follow button, kept on the same row.
  children: React.ReactNode;
};

export function ChallengeControl({ state, target, viewerRank, following, followsYou, online, children }: ChallengeControlProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();
  const router = useRouter();

  // A challenge expires on the server; re-render the page then, so "Challenge sent" turns back into Challenge.
  const expiresInMs = state.kind === "pending" ? state.expiresInMs : null;
  useEffect(() => {
    if (expiresInMs === null) return;
    const timer = setTimeout(() => router.refresh(), expiresInMs + 500);
    return () => clearTimeout(timer);
  }, [expiresInMs, router]);

  const label = (
    <>
      <ArenaIcon />
      Challenge
    </>
  );

  let button: React.ReactNode;
  let note: React.ReactNode = null;
  // A pending challenge stays cancelable even if you've since unfollowed.
  if (state.kind !== "pending" && !(following && followsYou)) {
    button = (
      <button type="button" className="profile-challenge-button is-locked" disabled aria-describedby={noteId}>
        <LockIcon />
        Challenge
      </button>
    );
    note = (
      <>
        Challenges are friends-only —{" "}
        {followsYou
          ? `${target.name} follows you, so follow back to challenge them.`
          : following
            ? `you can challenge ${target.name} once they follow you back.`
            : `follow each other to challenge ${target.name}.`}
      </>
    );
  } else if (state.kind !== "pending" && state.kind !== "signed-out" && !online) {
    button = (
      <button type="button" className="profile-challenge-button is-locked" disabled aria-describedby={noteId}>
        <LockIcon />
        Challenge
      </button>
    );
    note = <>{target.name} is offline — challenges need you both online. This unlocks as soon as they&rsquo;re back.</>;
  } else if (state.kind === "signed-out") {
    button = (
      <SignInAction>
        <button type="button" className="profile-challenge-button">
          {label}
        </button>
      </SignInAction>
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
        {state.terms} · waiting on {target.name}, who has {CHALLENGE_TTL_SECONDS / 60} minutes to accept.{" "}
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
  const [market, setMarket] = useState<string>(PULSE_MARKETS[0].id);
  const [timerSeconds, setTimerSeconds] = useState(PULSE_ROUNDS[0]);
  const [stake, setStake] = useState(CHALLENGE_STAKES[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function send() {
    startTransition(async () => {
      setError(null);
      try {
        const result = await sendChallenge({ handle: target.handle, market, timerSeconds, stake });
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

          <p className="challenge-pulse">
            <SwiftIcon />
            <strong>Pulse</strong>
            <span className="muted">{PULSE_BLURB}</span>
          </p>

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

          <fieldset className="challenge-group">
            <legend>Stake</legend>
            <div className="challenge-options">
              {[...CHALLENGE_STAKES, NO_STAKE].map((amount) => (
                <button key={amount} type="button" aria-pressed={stake === amount} onClick={() => setStake(amount)}>
                  {stakeLabel(amount)}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="challenge-summary">
            <strong>{challengeTerms({ mode: "pulse", market, timerSeconds, stake })}</strong>
            <span className="muted">
              {stake === NO_STAKE ? "Just for bragging rights — no Embers change hands." : <>Embers are reserved when {target.name} accepts and you join the round.</>}
            </span>
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
