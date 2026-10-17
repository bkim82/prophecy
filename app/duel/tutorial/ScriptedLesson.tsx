"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CountdownRing } from "@/app/PulseArenaParts";
import { pulseLiquidationPrice, pulsePositionPnl, type PulseSide } from "@/lib/pulse";
import LessonChart from "./LessonChart";
import {
  BELL_INDEX,
  ENTRY_INDEX,
  FALLBACK_ANCHOR,
  heldOutcome,
  LEAD_IN_S,
  LESSON_STAKE,
  lessonDomain,
  lessonPathPct,
  lessonPosition,
  liquidationDistancePct,
  liquidationIn,
  movePct,
  peakOf,
  ROUND_S,
  SAMPLE_S,
  sampleIndex,
  STEP_LABELS,
  toPrices,
  type LessonDef,
  type LessonExit,
  type LessonOutcome,
  type PathPoint,
} from "./lessons";

export type LessonPreset = { side?: PulseSide; leverage?: number };

type Phase = "brief" | "running" | "debrief";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const pct = (n: number, digits = 2) => `${Math.abs(n).toFixed(digits)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${pct(n)}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");
const sideColor = (side: PulseSide) => (side === "long" ? "var(--chart-up)" : "var(--chart-down)");
const sideLabel = (side: PulseSide) => (side === "long" ? "Long" : "Short");
/** "6.7" not "6.67" — distances are a rule of thumb, not a quote. */
const roughPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** Lesson 3's table: the same 1% move at a few leverages. */
const LEVERAGE_TABLE = [1, 5, 10, 20];
/** Share of the peak that counts as a well-timed close in lesson 5. */
const GREAT_CLOSE_SHARE = 0.7;

export default function ScriptedLesson({
  def,
  index,
  livePrice,
  preset,
  onFinish,
  onReplay,
  onNext,
  playFeedback,
}: {
  def: LessonDef;
  index: number;
  /** Latest BTC price; the lesson anchors to the first one it sees. */
  livePrice: number | null;
  preset?: LessonPreset;
  onFinish: (outcome: LessonOutcome) => void;
  onReplay: (preset?: LessonPreset) => void;
  onNext: () => void;
  playFeedback: (kind: "entry" | "exit" | "reverse") => void;
}) {
  // Anchored to the real BTC price so the lesson reads like the live game.
  // Picked up while the player reads the brief (the feed may still be
  // seeding), then frozen for the round.
  const [anchorPrice, setAnchorPrice] = useState(livePrice);
  const anchor = anchorPrice ?? FALLBACK_ANCHOR;
  const path = useMemo(() => toPrices(lessonPathPct(def), anchor), [def, anchor]);
  const domain = useMemo(() => lessonDomain(path, anchor, def.includePct), [path, anchor, def.includePct]);
  const entryPrice = path[ENTRY_INDEX].p;

  const [phase, setPhase] = useState<Phase>("brief");
  useEffect(() => {
    if (phase === "brief" && anchorPrice === null && livePrice !== null) setAnchorPrice(livePrice);
  }, [phase, anchorPrice, livePrice]);
  const [side, setSide] = useState<PulseSide | null>(
    preset?.side ?? (def.sides.length === 1 ? def.sides[0] : null),
  );
  const [leverage, setLeverage] = useState<number | null>(
    def.leverage.kind === "fixed"
      ? def.leverage.value
      : preset?.leverage ?? (def.leverage.kind === "slider" ? def.leverage.initial : null),
  );
  const [revealIndex, setRevealIndex] = useState(ENTRY_INDEX);
  const [exit, setExit] = useState<LessonExit | null>(null);
  const [outcome, setOutcome] = useState<LessonOutcome | null>(null);
  const exitRef = useRef<LessonExit | null>(null);
  const revealRef = useRef(revealIndex);
  revealRef.current = revealIndex;
  const debriefRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  const position = side && leverage ? lessonPosition(side, entryPrice, leverage) : null;
  const liquidationPrice = def.showLiquidation && position ? pulseLiquidationPrice(position) : null;

  // Playback: the 60-second clock runs in def.realMs. Liquidation is checked
  // on every sample passed, so a dropped frame can't skip over it.
  useEffect(() => {
    if (phase !== "running" || !position) return;
    const started = performance.now();
    let last = ENTRY_INDEX;
    let raf = 0;
    let doneTimer = 0;

    const tick = (now: number) => {
      const s = Math.min(ROUND_S, ((now - started) / def.realMs) * ROUND_S);
      const idx = Math.min(BELL_INDEX, Math.floor((s + LEAD_IN_S) / SAMPLE_S));
      if (idx !== last) {
        if (!exitRef.current) {
          const liquidated = liquidationIn(path, position, last + 1, idx);
          if (liquidated) {
            exitRef.current = liquidated;
            setExit(liquidated);
            playFeedback("exit");
          }
        }
        last = idx;
        setRevealIndex(idx);
      }
      if (idx < BELL_INDEX) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const bell = path[BELL_INDEX];
      const finalExit = exitRef.current ?? { s: bell.s, p: bell.p, pnl: pulsePositionPnl(position, bell.p), kind: "bell" as const };
      if (!exitRef.current) {
        exitRef.current = finalExit;
        setExit(finalExit);
        playFeedback("exit");
      }
      const result: LessonOutcome = { lesson: def.id, side: position.side, leverage: position.leverage, entry: entryPrice, exit: finalExit, bellPrice: bell.p };
      setOutcome(result);
      onFinish(result);
      // A beat on the final frame before the debrief takes over.
      doneTimer = window.setTimeout(() => setPhase("debrief"), 700);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(doneTimer);
    };
    // Runs once per round: everything it reads is fixed once the round starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "debrief") debriefRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [phase]);

  const start = (chosen: PulseSide) => {
    if (phase !== "brief" || !leverage || !def.sides.includes(chosen)) return;
    setAnchorPrice(anchor);
    setSide(chosen);
    setPhase("running");
    playFeedback("entry");
    // Stacked (phones), the chart sits above the controls just pressed; bring
    // it into view. Side by side it's pinned on screen already.
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const close = () => {
    if (phase !== "running" || !position || exitRef.current) return;
    const point = path[revealRef.current];
    const closed: LessonExit = { s: point.s, p: point.p, pnl: pulsePositionPnl(position, point.p), kind: "closed" };
    exitRef.current = closed;
    setExit(closed);
    playFeedback("exit");
  };

  const head = path[revealIndex];
  const livePnl = exit ? exit.pnl : position ? pulsePositionPnl(position, head.p) : 0;
  const secondsLeft = Math.max(0, Math.ceil(ROUND_S - head.s - 1e-9));
  const speedLabel = `1 minute in ${def.realMs / 1000} seconds`;
  // Lesson 5 shows how far the trade has come off its best so far.
  const bestSoFar = position && def.canClose ? bestPnlUpTo(path, position, exit ? Math.min(revealIndex, sampleIndex(exit.s)) : revealIndex) : 0;
  const peak = phase === "debrief" && def.id === "close" && position ? peakOf(path, position) : null;

  return (
    <>
      {/* Once the result is in, the lesson text folds away to its title so the debrief sits up top. */}
      <section className={`tut-card arena-panel${phase === "debrief" ? " is-collapsed" : ""}`}>
        <p className="tut-kicker">
          Lesson {index + 1} of {STEP_LABELS.length} · {def.step}
        </p>
        <LessonBrief def={def} />
      </section>

      <section ref={stageRef} className="tut-stage">
        <div className="tut-stage-bar">
          <div className="tut-stage-price">
            <span className="tut-stage-label">BTC / USD</span>
            <strong className="tabular-nums">{usd(head.p)}</strong>
            {phase !== "brief" && (
              <span className="tabular-nums" style={{ color: pnlColor(movePct(entryPrice, head.p)) }}>
                {signedPct(movePct(entryPrice, head.p))}
              </span>
            )}
          </div>
          <div className="tut-stage-clock">
            <CountdownRing seconds={secondsLeft} total={ROUND_S} urgent={phase === "running" && secondsLeft <= 10} />
            <span>
              <strong>{phase === "brief" ? "Ready" : phase === "running" ? "Round live" : "Round over"}</strong>
              <span className="muted">Scripted replay · {speedLabel}</span>
            </span>
          </div>
        </div>
        <LessonChart
          path={path}
          revealIndex={revealIndex}
          domain={domain}
          side={side}
          entered={phase !== "brief"}
          liquidationPrice={liquidationPrice}
          exit={exit && sampleIndex(exit.s) <= revealIndex ? exit : null}
          peak={peak}
        />
      </section>

      {phase === "brief" && (
        <BriefControls def={def} leverage={leverage} setLeverage={setLeverage} onStart={start} />
      )}

      {phase === "running" && position && (
        <section className="tut-controls arena-dock dock-bar" aria-live="polite">
          <div className="dock-row">
            {exit?.kind === "liquidated" ? (
              <span className="dock-chip" style={{ borderColor: "var(--negative)", color: "var(--negative)" }}>
                LIQUIDATED
              </span>
            ) : (
              <span className="dock-chip" style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}>
                {position.side.toUpperCase()}
              </span>
            )}
            <span className="dock-live-pnl dock-pnl-hero" style={{ color: pnlColor(livePnl) }}>
              {signedUsd(livePnl)}
            </span>
            <span className="dock-meta">
              <span>
                {usd(entryPrice)} → {usd(exit ? exit.p : head.p)}
              </span>
              <span>
                {usd(LESSON_STAKE)} · {position.leverage}×
              </span>
            </span>
          </div>
          {def.canClose && !exit && (
            <>
              <p className="tut-peak-note tabular-nums">
                Best so far <strong style={{ color: pnlColor(bestSoFar) }}>{signedUsd(bestSoFar)}</strong>
                {bestSoFar > 0 && bestSoFar - livePnl > 0.5 && (
                  <> · <span style={{ color: "var(--negative)" }}>{usd(bestSoFar - livePnl)} off the high</span></>
                )}
              </p>
              <div className="dock-row">
                <button type="button" onClick={close} className={`dock-action is-${position.side} arena-choice tut-close-button`}>
                  Close &amp; lock in {signedUsd(livePnl)}
                </button>
              </div>
            </>
          )}
          <p className="mt-2 text-center text-xs text-[var(--muted)]">
            {runningHint(def, exit, position.leverage)}
          </p>
        </section>
      )}

      {phase === "debrief" && outcome && (
        <section ref={debriefRef} className="tut-debrief" aria-live="polite">
          <LessonDebrief def={def} outcome={outcome} path={path} />
          <div className="tut-actions">
            <button type="button" className="tut-button-secondary" onClick={() => onReplay(replayPreset(def, outcome))}>
              {replayLabel(def, outcome)}
            </button>
            <button type="button" className="tut-button-primary" onClick={onNext}>
              {index + 1 < STEP_LABELS.length - 1 ? `Next: ${STEP_LABELS[index + 1]}` : "Next: the live round"} <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function bestPnlUpTo(path: PathPoint[], position: ReturnType<typeof lessonPosition>, upTo: number) {
  let best = 0;
  for (let i = ENTRY_INDEX; i <= upTo; i++) best = Math.max(best, pulsePositionPnl(position, path[i].p));
  return best;
}

function runningHint(def: LessonDef, exit: LessonExit | null, leverage: number) {
  if (exit?.kind === "liquidated") {
    return `Liquidated — BTC fell ${roughPct(liquidationDistancePct(leverage))} and wiped out your ${usd(LESSON_STAKE)}. Keep watching what the price does next…`;
  }
  if (exit?.kind === "closed") return `Closed at ${signedUsd(exit.pnl)}. Watch what the price does after you leave…`;
  switch (def.id) {
    case "long":
      return "Above your entry line is profit (green). Below it is loss (red).";
    case "short":
      return "For a short it flips: below your entry is profit, above it is loss.";
    case "leverage":
      return `Every 1% move is worth ${usd(leverage)} at ${leverage}×.`;
    case "liquidation":
      return "Watch the red line: if the price touches it, your trade is over.";
    case "close":
      return "Close whenever you think the climb is over — or let the clock do it.";
  }
}

function replayPreset(def: LessonDef, outcome: LessonOutcome): LessonPreset | undefined {
  if (def.id === "liquidation") return { leverage: outcome.exit.kind === "liquidated" ? 15 : 25 };
  if (def.id === "leverage") return { leverage: outcome.leverage };
  return undefined;
}

function replayLabel(def: LessonDef, outcome: LessonOutcome) {
  if (def.id === "liquidation") return outcome.exit.kind === "liquidated" ? "Replay at 15×" : "See it at 25×";
  if (def.id === "short" && outcome.exit.pnl < 0) return "Try again";
  return "Replay lesson";
}

function LessonBrief({ def }: { def: LessonDef }) {
  switch (def.id) {
    case "long":
      return (
        <>
          <h2 className="tut-title">Going long: bet the price goes up</h2>
          <p className="tut-body">
            Going <b>long</b> means you think the price will <b>rise</b>. If it does, you make money. If it falls, you lose money.
          </p>
          <p className="tut-body muted">
            We&apos;ll put {usd(LESSON_STAKE)} of your practice money on Bitcoin. This 1-minute round is sped up, so it plays in 10 seconds.
          </p>
        </>
      );
    case "short":
      return (
        <>
          <h2 className="tut-title">Going short: bet the price goes down</h2>
          <p className="tut-body">
            Going <b>short</b> is the opposite: you make money when the price <b>falls</b>. Pulse lets you win in either direction. You just have to pick the right one.
          </p>
          <p className="tut-body muted">Bitcoin has been sliding. Which way do you think it goes next?</p>
        </>
      );
    case "leverage":
      return (
        <>
          <h2 className="tut-title">Leverage: make every move count more</h2>
          <p className="tut-body">
            Leverage makes your {usd(LESSON_STAKE)} trade like a bigger amount. At <b>10×</b>, your $100 moves like $1,000, so every gain <b>and every loss</b> is 10 times bigger.
          </p>
          <p className="tut-body muted">Pick a leverage, then go long. This time Bitcoin moves about 1%.</p>
        </>
      );
    case "liquidation":
      return (
        <>
          <h2 className="tut-title">Liquidation: when your stake runs out</h2>
          <p className="tut-body">
            A trade can lose its {usd(LESSON_STAKE)} stake and no more. When losses eat all of it, you&apos;re <b>liquidated</b>: the trade is closed for you and the money is gone, even if the price comes back later.
          </p>
          <p className="tut-key">
            The higher your leverage, the smaller the move that wipes you out: about <b>100% ÷ leverage</b>. At 25×, a 4% drop is enough.
          </p>
          <p className="tut-body muted">You&apos;re sure Bitcoin will finish this minute higher. Pick your leverage and go long.</p>
        </>
      );
    case "close":
      return (
        <>
          <h2 className="tut-title">Closing: lock in your win</h2>
          <p className="tut-body">
            You don&apos;t have to wait for the clock. Press <b>Close</b> any time to lock in your profit, or to stop a loss from growing. Anything still open when the clock hits 0 closes automatically at whatever the price is right then.
          </p>
          <ul className="tut-tips">
            <li><b>Take profit when the move stalls</b>, when the price stops making new highs.</li>
            <li><b>Don&apos;t hunt for the exact top.</b> Nobody can call it. Close while you&apos;re still well up.</li>
            <li><b>Don&apos;t let the clock decide for you.</b></li>
          </ul>
          <p className="tut-body muted">Go long at 10×, then press Close when you think the climb is over. This one plays a little slower: 15 seconds.</p>
        </>
      );
  }
}

function BriefControls({
  def,
  leverage,
  setLeverage,
  onStart,
}: {
  def: LessonDef;
  leverage: number | null;
  setLeverage: (value: number) => void;
  onStart: (side: PulseSide) => void;
}) {
  const sideButton = (option: PulseSide, label: string) => {
    const allowed = def.sides.includes(option);
    return (
      <button
        key={option}
        type="button"
        disabled={!allowed || !leverage}
        onClick={() => onStart(option)}
        className={`dock-action is-${option} ${allowed && leverage ? "arena-choice" : ""}`}
      >
        {allowed ? label : <span className="tut-locked">{option === "short" ? "↘ Short · lesson 2" : "↗ Long"}</span>}
      </button>
    );
  };
  const goLabel = (option: PulseSide) =>
    `${option === "long" ? "↗" : "↘"} ${def.sides.length > 1 ? sideLabel(option) : `Go ${option}`}${def.leverage.kind !== "fixed" && leverage ? ` at ${leverage}×` : ""}`;

  return (
    <section className="tut-controls arena-dock dock-bar">
      {def.leverage.kind === "slider" && leverage !== null && (
        <LeverageSlider min={def.leverage.min} max={def.leverage.max} value={leverage} onChange={setLeverage} />
      )}
      {def.leverage.kind === "choice" && (
        <LeverageChoice options={def.leverage.options} value={leverage} onChange={setLeverage} />
      )}
      <div className="dock-row">
        {def.sides.length > 1
          ? (["long", "short"] as const).map((option) => sideButton(option, goLabel(option)))
          : (
            <>
              {sideButton("long", goLabel("long"))}
              {def.id === "long" && sideButton("short", "")}
            </>
          )}
      </div>
      <p className="mt-2 text-center text-xs text-[var(--muted)]">
        {!leverage
          ? "Pick a leverage to continue."
          : `Stake ${usd(LESSON_STAKE)} · ${leverage}× leverage · practice money only`}
      </p>
      {def.leverage.kind === "slider" && leverage !== null && <LeverageTable value={leverage} />}
    </section>
  );
}

function LeverageSlider({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (value: number) => void }) {
  const onePct = (LESSON_STAKE * value) / 100;
  return (
    <div className="tut-leverage">
      <label className="tut-slider">
        <span className="tut-slider-head">
          <span className="field-label">Leverage</span>
          <strong className="tabular-nums">{value}×</strong>
        </span>
        <input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="tut-slider-scale" aria-hidden="true">
          <span>{min}×</span>
          <span>{max}×</span>
        </span>
      </label>
      <div className="tut-leverage-readout">
        <span>
          Trades like <strong className="tabular-nums">{usd(LESSON_STAKE * value)}</strong>
        </span>
        <span>
          1% your way <strong className="tabular-nums" style={{ color: "var(--positive)" }}>{signedUsd(onePct)}</strong>
        </span>
        <span>
          1% against <strong className="tabular-nums" style={{ color: "var(--negative)" }}>{signedUsd(-onePct)}</strong>
        </span>
      </div>
    </div>
  );
}

function LeverageTable({ value }: { value: number }) {
  return (
    <table className="tut-table">
      <caption>The same 1% move on a {usd(LESSON_STAKE)} stake</caption>
      <thead>
        <tr>
          <th scope="col">Leverage</th>
          <th scope="col">1% your way</th>
          <th scope="col">1% against you</th>
        </tr>
      </thead>
      <tbody>
        {LEVERAGE_TABLE.map((option) => (
          <tr key={option} className={option === value ? "is-current" : undefined}>
            <th scope="row">{option}×</th>
            <td style={{ color: "var(--positive)" }}>{signedUsd((LESSON_STAKE * option) / 100)}</td>
            <td style={{ color: "var(--negative)" }}>{signedUsd(-(LESSON_STAKE * option) / 100)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeverageChoice({ options, value, onChange }: { options: readonly number[]; value: number | null; onChange: (value: number) => void }) {
  return (
    <div className="tut-choice" role="radiogroup" aria-label="Leverage">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "is-selected" : undefined}
          onClick={() => onChange(option)}
        >
          <strong>{option}×</strong>
          <span>wiped out by a {roughPct(liquidationDistancePct(option))} drop</span>
        </button>
      ))}
    </div>
  );
}

function LessonDebrief({ def, outcome, path }: { def: LessonDef; outcome: LessonOutcome; path: PathPoint[] }) {
  const { exit, side, leverage, entry, bellPrice } = outcome;
  const bellMove = movePct(entry, bellPrice);
  const headline = (
    <h3 className="tut-debrief-headline tabular-nums" style={{ color: pnlColor(exit.pnl) }}>
      {signedUsd(exit.pnl)}
    </h3>
  );

  switch (def.id) {
    case "long":
      return (
        <>
          <p className="tut-kicker">Result</p>
          {headline}
          <p className="tut-body">
            Bitcoin rose <b>{pct(bellMove)}</b>, so your {usd(LESSON_STAKE)} grew by {pct(bellMove)}: <b>{signedUsd(exit.pnl)}</b>.
          </p>
          <p className="tut-key"><b>Long</b> = you profit when the price goes up.</p>
          <p className="tut-body muted">Small, right? Lesson 3 shows how leverage makes it bigger.</p>
        </>
      );
    case "short": {
      const right = side === "short";
      return (
        <>
          <p className="tut-kicker">{right ? "Good call" : "Not this time"}</p>
          {headline}
          <p className="tut-body">
            {right ? (
              <>Bitcoin fell <b>{pct(bellMove)}</b>, and your short earned <b>{signedUsd(exit.pnl)}</b>.</>
            ) : (
              <>
                Bitcoin fell <b>{pct(bellMove)}</b>, so your long lost <b>{usd(Math.abs(exit.pnl))}</b>. A short would have <b>made {signedUsd(-exit.pnl)}</b> on the very same move.
              </>
            )}
          </p>
          <p className="tut-key"><b>Short</b> = you profit when the price goes down. <b>Long</b> = you profit when it goes up.</p>
        </>
      );
    }
    case "leverage": {
      const rows = [...new Set([...LEVERAGE_TABLE, leverage])].sort((a, b) => a - b);
      return (
        <>
          <p className="tut-kicker">Result at {leverage}×</p>
          {headline}
          <p className="tut-body">
            Bitcoin rose <b>{pct(bellMove)}</b>. At <b>{leverage}×</b>, that&apos;s {leverage} × {pct(bellMove)} = {pct(bellMove * leverage, 0)} of your {usd(LESSON_STAKE)}: <b>{signedUsd(exit.pnl)}</b>.
          </p>
          <table className="tut-table">
            <caption>This same trade at other leverages</caption>
            <thead>
              <tr>
                <th scope="col">Leverage</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((option) => (
                <tr key={option} className={option === leverage ? "is-current" : undefined}>
                  <th scope="row">{option}×{option === leverage ? " (you)" : ""}</th>
                  <td style={{ color: "var(--positive)" }}>{signedUsd(heldOutcome(path, "long", option).pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tut-warn">
            Leverage cuts both ways. If Bitcoin had <b>fallen</b> 1%, you&apos;d have lost {usd(Math.abs(exit.pnl))}. Push leverage far enough and one move against you wipes out your whole {usd(LESSON_STAKE)}. That&apos;s the next lesson.
          </p>
          <p className="tut-key">Leverage multiplies your profit <b>and</b> your loss by the same amount.</p>
        </>
      );
    }
    case "liquidation": {
      const options = def.leverage.kind === "choice" ? def.leverage.options : [];
      const dip = Math.min(...path.slice(ENTRY_INDEX, BELL_INDEX + 1).map((point) => movePct(entry, point.p)));
      const liquidated = exit.kind === "liquidated";
      return (
        <>
          <p className="tut-kicker">{liquidated ? "Liquidated" : "You survived"}</p>
          {headline}
          <p className="tut-body">
            {liquidated ? (
              <>
                Bitcoin dipped <b>{pct(dip)}</b>, past your {leverage}× liquidation point ({roughPct(liquidationDistancePct(leverage))} down), so your {usd(LESSON_STAKE)} was gone. Then it recovered and finished <b>{signedPct(bellMove)}</b>. You were right about the direction and <b>still lost everything</b>.
              </>
            ) : (
              <>
                Bitcoin dipped <b>{pct(dip)}</b>, but at {leverage}× you could take a {roughPct(liquidationDistancePct(leverage))} drop, so you stayed in. It finished <b>{signedPct(bellMove)}</b>: <b>{signedUsd(exit.pnl)}</b>. At 25×, the same trade was liquidated at −4% and lost the whole {usd(LESSON_STAKE)}.
              </>
            )}
          </p>
          <table className="tut-table">
            <caption>The same trade at each leverage</caption>
            <thead>
              <tr>
                <th scope="col">Leverage</th>
                <th scope="col">Wiped out by</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {options.map((option) => {
                const held = heldOutcome(path, "long", option);
                const wiped = held.kind === "liquidated";
                const ifHeld = pulsePositionPnl(lessonPosition("long", entry, option), bellPrice);
                return (
                  <tr key={option} className={option === leverage ? "is-current" : undefined}>
                    <th scope="row">{option}×{option === leverage ? " (you)" : ""}</th>
                    <td>{roughPct(liquidationDistancePct(option))} drop</td>
                    <td style={{ color: pnlColor(held.pnl) }}>
                      {wiped ? <>Liquidated {signedUsd(held.pnl)} <span className="muted">(would have made {signedUsd(ifHeld)})</span></> : signedUsd(held.pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="tut-key">Pick a leverage that can survive a dip. Being right only pays if you&apos;re still in the trade.</p>
        </>
      );
    }
    case "close": {
      const position = lessonPosition(side, entry, leverage);
      const peak = peakOf(path, position);
      const held = heldOutcome(path, side, leverage);
      const share = peak.pnl > 0 ? exit.pnl / peak.pnl : 0;
      const verdict =
        exit.kind === "bell"
          ? "The clock closed it for you"
          : exit.pnl <= 0
            ? "Closed a little early"
            : share >= GREAT_CLOSE_SHARE
              ? "Great timing"
              : "A win locked in";
      return (
        <>
          <p className="tut-kicker">{verdict}</p>
          {headline}
          <p className="tut-body">
            {exit.kind === "bell" ? (
              <>
                At its best this trade was up <b>{signedUsd(peak.pnl)}</b> (the gold diamond). Then the climb stalled, the price rolled over, and the clock closed you at <b>{signedUsd(exit.pnl)}</b>. A profit turned into a loss while you waited.
              </>
            ) : exit.pnl <= 0 ? (
              <>
                You closed at <b>{signedUsd(exit.pnl)}</b>, before the climb got going. It went on to peak at <b>{signedUsd(peak.pnl)}</b>. Give a trade that&apos;s moving your way room to run, and close when it stops climbing.
              </>
            ) : share >= GREAT_CLOSE_SHARE ? (
              <>
                You closed at <b>{signedUsd(exit.pnl)}</b>, {Math.round(share * 100)}% of the best possible {signedUsd(peak.pnl)}. Waiting for the clock would have ended at <b>{signedUsd(held.pnl)}</b>.
              </>
            ) : (
              <>
                You locked in <b>{signedUsd(exit.pnl)}</b>. The peak was {signedUsd(peak.pnl)}, so there was more on the table, but a win you lock in beats one you give back: waiting for the clock ended at <b>{signedUsd(held.pnl)}</b>.
              </>
            )}
          </p>
          <div className="tut-rules">
            <p className="field-label">When to close a trade</p>
            <ol>
              <li><b>It stalls: take the profit.</b> The price stops making new highs (or new lows on a short). The move may be done.</li>
              <li><b>It&apos;s going wrong: cut it early.</b> A small loss beats riding it to liquidation.</li>
              <li><b>Final seconds: lock it in.</b> At 0:00 everything closes at whatever the price is.</li>
              <li><b>Closing isn&apos;t the end.</b> You can open a new trade any time before the bell.</li>
            </ol>
          </div>
          <p className="tut-key">Close on your terms. Don&apos;t wait for the perfect top, and never leave it to the clock.</p>
        </>
      );
    }
  }
}
