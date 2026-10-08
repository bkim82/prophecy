"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PulseMarketTitle from "@/app/PulseMarketTitle";
import { usePulseFeedback } from "@/app/PulseArenaParts";
import { usePriceFeed } from "@/app/usePriceFeed";
import { PULSE_WAGER_OPTIONS } from "@/lib/pulse";
import LiveRound from "./LiveRound";
import ScriptedLesson, { type LessonPreset } from "./ScriptedLesson";
import { LESSONS, PRACTICE_BALANCE, STEP_LABELS, type LessonId, type LessonOutcome } from "./lessons";
import { markTutorialDone } from "./progress";

/** "intro", a lesson index (LESSONS.length = the live round), or "done". */
type Step = "intro" | number | "done";

const LIVE_INDEX = LESSONS.length;

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * `onExit` is set when the tutorial runs as the last stage of /welcome
 * (app/welcome/OnboardingFlow.tsx): the back link becomes "Skip tutorial" and
 * the done screen's Continue hands back to onboarding instead of the Arena.
 */
export function TutorialView({ onExit }: { onExit?: () => void } = {}) {
  // One feed for the whole tutorial: it anchors the scripted lessons to the
  // real BTC price and is already warm when the live round starts.
  const feed = usePriceFeed("BTC-USD");
  const { muted, toggleMuted, playFeedback } = usePulseFeedback();
  const [step, setStep] = useState<Step>("intro");
  // Latest P&L per lesson; replaying a lesson replaces its entry.
  const [results, setResults] = useState<Partial<Record<LessonId, number>>>({});
  const [liveDone, setLiveDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preset, setPreset] = useState<LessonPreset | undefined>(undefined);

  const balance = PRACTICE_BALANCE + Object.values(results).reduce((sum, pnl) => sum + (pnl ?? 0), 0);

  const goTo = (next: Step, nextPreset?: LessonPreset) => {
    setPreset(nextPreset);
    setAttempt((n) => n + 1);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (step === "done") markTutorialDone();
  }, [step]);

  const recordResult = (outcome: LessonOutcome) =>
    setResults((current) => ({ ...current, [outcome.lesson]: outcome.exit.pnl }));

  const isDone = (index: number) => (index === LIVE_INDEX ? liveDone : results[LESSONS[index].id] !== undefined);

  return (
    // Lessons split the screen: steps + lesson on the left, the chart on the
    // right (see .tut-shell.is-split). Intro and done stay one centered column.
    <main className={`arena-shell tut-shell${typeof step === "number" ? " is-split" : ""}`} data-market="btc">
      <header className="tut-head">
        <div className="tut-head-row">
          {!onExit ? (
            <Link href="/duel" className="tut-back">
              ← Arena
            </Link>
          ) : step !== "done" && (
            <button type="button" className="tut-back" onClick={onExit}>
              Skip tutorial
            </button>
          )}
          <PulseMarketTitle market="btc">Learn Pulse</PulseMarketTitle>
          {typeof step === "number" && step < LIVE_INDEX && (
            <p className="tut-balance" title="Practice money only. No Embers at stake.">
              Practice <strong className="tabular-nums">{usd(balance)}</strong>
            </p>
          )}
        </div>
        <nav aria-label="Tutorial lessons">
          <ol className="tut-steps">
            {STEP_LABELS.map((label, index) => {
              const current = step === index;
              const done = isDone(index);
              return (
                <li key={label}>
                  <button
                    type="button"
                    className={`tut-step${current ? " is-current" : ""}${done ? " is-done" : ""}`}
                    aria-current={current ? "step" : undefined}
                    onClick={() => goTo(index)}
                  >
                    <span className="tut-step-dot" aria-hidden="true">{done && !current ? "✓" : index + 1}</span>
                    <span className="tut-step-label">{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      {step === "intro" && (
        <>
          <section className="tut-card tut-hero arena-panel">
            <p className="tut-kicker">{onExit ? "Last step · skip anytime" : "Pulse tutorial · for first-timers"}</p>
            <h2 className="tut-title">Learn Pulse in a few minutes</h2>
            <p className="tut-body">
              Pulse is a 60-second trading duel on the live price of Bitcoin. You bet on whether the price goes <b>up</b> or <b>down</b>. When the clock runs out, whoever has made more money wins.
            </p>
            <ul className="tut-intro-list">
              <li>
                <strong>5 quick lessons, one idea each</strong>
                <span>Long, short, leverage, liquidation, and when to close a trade.</span>
              </li>
              <li>
                <strong>Then a real 60-second round</strong>
                <span>Live Bitcoin prices, against Sibyl, our practice bot.</span>
              </li>
              <li>
                <strong>{usd(PRACTICE_BALANCE)} of practice money</strong>
                <span>It never touches your Embers. Nothing is at stake, so experiment freely.</span>
              </li>
            </ul>
            <div className="tut-actions">
              <button type="button" className="tut-button-secondary" onClick={() => goTo(LIVE_INDEX)}>
                Skip to the live round
              </button>
              <button type="button" className="tut-button-primary" onClick={() => goTo(0)}>
                Start lesson 1 <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        </>
      )}

      {typeof step === "number" && step < LIVE_INDEX && (
        <ScriptedLesson
          key={`${step}-${attempt}`}
          def={LESSONS[step]}
          index={step}
          livePrice={feed.price}
          preset={preset}
          onFinish={recordResult}
          onReplay={(nextPreset) => goTo(step, nextPreset)}
          onNext={() => goTo(step + 1)}
          playFeedback={playFeedback}
        />
      )}

      {step === LIVE_INDEX && (
        <LiveRound
          key={attempt}
          feed={feed}
          muted={muted}
          toggleMuted={toggleMuted}
          playFeedback={playFeedback}
          onComplete={() => {
            setLiveDone(true);
            goTo("done");
          }}
        />
      )}

      {step === "done" && (
        <section className="tut-card tut-hero arena-panel">
          <p className="tut-kicker">Tutorial complete</p>
          <h2 className="tut-title">You&apos;re ready for ranked Pulse</h2>
          <ol className="tut-recap">
            <li><b>Long</b>: you profit when the price rises.</li>
            <li><b>Short</b>: you profit when it falls.</li>
            <li><b>Leverage</b> multiplies your wins and your losses alike.</li>
            <li><b>Liquidation</b>: a move of about 100% ÷ leverage against you wipes out your stake, even if the price comes back.</li>
            <li><b>Close on your terms</b>: take profit when the move stalls, cut losers early, and don&apos;t leave it to the clock.</li>
            <li>
              <b>Ranked play</b> is the same game against a real opponent, with {PULSE_WAGER_OPTIONS.join(", ")} Embers on the line. The winner takes both wagers.
            </li>
          </ol>
          <div className="tut-actions">
            <button type="button" className="tut-button-secondary" onClick={() => { setResults({}); setLiveDone(false); goTo("intro"); }}>
              Replay the tutorial
            </button>
            {onExit ? (
              <button type="button" className="tut-button-primary" onClick={onExit}>
                Continue <span aria-hidden="true">→</span>
              </button>
            ) : (
              <>
                <Link href="/duel/btc/pulse?practice=1&market=btc" className="tut-button-secondary">
                  More practice vs Sibyl
                </Link>
                <Link href="/duel" className="tut-button-primary">
                  Play ranked <span aria-hidden="true">→</span>
                </Link>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
