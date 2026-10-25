"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { REMATCH_SECONDS, clockLabel, stakeLabel } from "@/app/lib/challengeRules";
import { RIVAL_GRADIENT, YOU_GRADIENT } from "@/app/PulseArenaParts";
import type { RematchView } from "@/lib/rematch";

// A settled challenge round's "Play again" (lib/rematch.ts): the room polls
// GET /api/match/[id]/rematch, and pressing it POSTs. The first press asks;
// the other player sees a ready check with REMATCH_SECONDS to press it too,
// and once both have, both rooms move to the new round.

const POLL_MS = 1000;
const TICK_MS = 250;

/**
 * idle — nobody's asked. yours / theirs — a live ask, waiting on them / on you.
 * starting — both pressed it. lapsed — your ask ran out. missed — theirs did.
 * left — they closed the room, so there's no one to ask.
 */
export type RematchState = "idle" | "yours" | "theirs" | "starting" | "lapsed" | "missed" | "left";

type Rematch = {
  state: RematchState;
  secondsLeft: number;
  /** Share of the window left, 1 → 0, for the ready check's meter. */
  fraction: number;
  pressing: boolean;
  error: string | null;
  press: () => void;
};

/** `onNext` gets the new round's id once both have pressed Play again. */
export function useRematch(matchId: string, playerId: string | null, enabled: boolean, onNext: (nextMatchId: string) => void): Rematch {
  // `expiresAt` is on this browser's clock: received time + the server's `expiresInMs`.
  const [view, setView] = useState<(RematchView & { expiresAt: number }) | null>(null);
  const [pressing, setPressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback((next: RematchView) => {
    const receivedAt = Date.now();
    setNow(receivedAt);
    setView({ ...next, expiresAt: receivedAt + next.expiresInMs });
    if (next.nextMatchId) onNext(next.nextMatchId);
  }, [onNext]);

  const nextMatchId = view?.nextMatchId ?? null;
  useEffect(() => {
    if (!enabled || !playerId || nextMatchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/match/${encodeURIComponent(matchId)}/rematch?playerId=${encodeURIComponent(playerId)}`, { cache: "no-store" });
        if (cancelled) return;
        // Not a round that offers one, or not yours: nothing to wait for.
        if (res.status === 404 || res.status === 403 || res.status === 409) return;
        if (res.ok) {
          const next = (await res.json()) as RematchView;
          if (cancelled) return;
          apply(next);
          if (next.nextMatchId) return;
        }
      } catch {
        // Keep polling through transient API failures.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, matchId, playerId, nextMatchId, apply]);

  const expiresAt = view?.expiresAt ?? 0;
  useEffect(() => {
    if (expiresAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [expiresAt]);

  const press = () => {
    if (!playerId || pressing || nextMatchId) return;
    setPressing(true);
    setError(null);
    fetch(`/api/match/${encodeURIComponent(matchId)}/rematch`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (RematchView & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't reach the room — try again.");
        apply(body);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Couldn't reach the room — try again."))
      .finally(() => setPressing(false));
  };

  const left = Math.max(0, expiresAt - now);
  const live = left > 0;
  const state: RematchState = !view
    ? "idle"
    : view.nextMatchId
      ? "starting"
      : view.askedBy === "opponent" && live && view.opponentPresent
        ? "theirs"
        : !view.opponentPresent
          ? "left"
          : view.askedBy === "you"
            ? live ? "yours" : "lapsed"
            : view.askedBy === "opponent"
              ? "missed"
              : "idle";

  return {
    state,
    secondsLeft: Math.ceil(left / 1000),
    fraction: Math.min(1, left / (REMATCH_SECONDS * 1000)),
    pressing,
    error,
    press,
  };
}

type Terms = { market: string; timerSeconds: number; wager: number };

/**
 * The ready check above the result card: who's pressed Play again, and how
 * long the other has to. Loudest when they're waiting on you.
 */
export function RematchCheck({ rematch, rivalName, rivalInitial, terms }: { rematch: Rematch; rivalName: string; rivalInitial: string; terms: Terms }) {
  const { state, secondsLeft, fraction } = rematch;
  const ref = useRef<HTMLElement>(null);
  // The result card sits under the chart; bring their ask on screen.
  useEffect(() => {
    if (state === "theirs") ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);
  if (state === "idle") return null;
  const copy: Record<Exclude<RematchState, "idle">, { title: string; detail: string }> = {
    theirs: { title: `${rivalName} pressed Play again`, detail: `They're waiting on you — press Play again to run it back.` },
    yours: { title: `Waiting for ${rivalName}`, detail: `You're in. ${rivalName} has ${secondsLeft}s to press Play again.` },
    starting: { title: "Rematch on", detail: "You're both in — starting the round…" },
    lapsed: { title: `${rivalName} didn't take the rematch`, detail: "Press Play again to ask once more." },
    missed: { title: `${rivalName} wanted a rematch`, detail: `Their ${REMATCH_SECONDS}s ran out — press Play again to ask them back.` },
    left: { title: `${rivalName} left the room`, detail: "There's no one here to rematch." },
  };
  const { title, detail } = copy[state];
  const counting = state === "theirs" || state === "yours";
  const youReady = state === "yours" || state === "starting";
  const theyReady = state === "theirs" || state === "starting";

  return (
    <section ref={ref} className="rematch-check" data-state={state} aria-live="polite">
      <div className="rematch-check-head">
        <span className="rematch-check-eyebrow">Rematch · {terms.market.toUpperCase()} · {terms.timerSeconds}s · {stakeLabel(terms.wager)}</span>
        {counting && <span className="rematch-check-clock">{clockLabel(secondsLeft)}</span>}
      </div>
      <p className="rematch-check-title">{title}</p>
      <p className="rematch-check-detail">{detail}</p>
      {(counting || state === "starting") && (
        <>
          <div className="rematch-seats">
            <RematchSeat name="You" initial="Y" gradient={YOU_GRADIENT} status={youReady ? "ready" : "turn"} />
            <RematchSeat name={rivalName} initial={rivalInitial} gradient={RIVAL_GRADIENT} status={theyReady ? "ready" : "deciding"} />
          </div>
          {counting && (
            <div className="rematch-meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${fraction})` }} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

const SEAT_LABEL = { ready: "✓ Ready", turn: "Your move", deciding: "Deciding…" } as const;

function RematchSeat({ name, initial, gradient, status }: { name: string; initial: string; gradient: string; status: keyof typeof SEAT_LABEL }) {
  return (
    <div className="rematch-seat" data-status={status}>
      <span className="duel-avatar h-8 w-8 text-xs" style={{ backgroundImage: gradient }} aria-hidden="true">{initial}</span>
      <span className="rematch-seat-name">{name}</span>
      <span className="rematch-seat-status">{SEAT_LABEL[status]}</span>
    </div>
  );
}

/** The result card's Play again, for a challenge round: asks, answers, or waits. */
export function RematchButton({ rematch, rivalName }: { rematch: Rematch; rivalName: string }) {
  const { state, secondsLeft, pressing, press } = rematch;
  const base = "rounded-md px-5 py-2 text-center text-sm font-medium transition";
  if (state === "left") {
    return <Link href="/duel" className={`${base} bg-[var(--btn-bg)] text-[var(--btn-text)] hover:bg-[var(--btn-bg-hover)]`}>Back to lobby</Link>;
  }
  const label = state === "starting" || (pressing && state === "theirs")
    ? "Starting…"
    : state === "yours"
      ? `Waiting for ${rivalName}… ${secondsLeft}s`
      : state === "theirs"
        ? `Play again · ${secondsLeft}s`
        : pressing ? "Asking…" : "Play again";
  return (
    <button
      type="button"
      onClick={press}
      disabled={pressing || state === "yours" || state === "starting"}
      className={`rematch-button ${base} bg-[var(--btn-bg)] text-[var(--btn-text)] hover:bg-[var(--btn-bg-hover)] disabled:cursor-default disabled:opacity-70${state === "theirs" ? " is-beckoning" : state === "yours" ? " is-waiting" : ""}`}
    >
      {label}
    </button>
  );
}
