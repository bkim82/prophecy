"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "@/app/PriceChart";
import PulseMovementAlert from "@/app/PulseMovementAlert";
import PulseStakeStepper from "@/app/PulseStakeStepper";
import {
  ArenaResultCard,
  ArenaScore,
  CountdownRing,
  FlashingPrice,
  LeadBar,
  RIVAL_GRADIENT,
  SibylFace,
  SoundToggle,
  YOU_GRADIENT,
} from "@/app/PulseArenaParts";
import type { usePriceFeed, PricePoint } from "@/app/usePriceFeed";
import {
  clampPulseStake,
  pulseIsLiquidated,
  pulseLiquidationPrice,
  pulsePositionPnl,
  PULSE_LEVERAGE_OPTIONS,
  type PulsePosition,
  type PulseSide,
} from "@/lib/pulse";
import {
  BOT_COOLDOWN_MS,
  BOT_LEVERAGE,
  BOT_STAKE,
  botDecide,
  coachTip,
  LIVE_DEFAULT_STAKE,
  LIVE_ROUND_SECONDS,
  LIVE_STARTING_CASH,
  type BotMemory,
} from "./live";
import { STEP_LABELS } from "./lessons";

type Feed = ReturnType<typeof usePriceFeed>;
type Phase = "setup" | "open" | "settling" | "result";
type Owner = "you" | "sibyl";

type Trade = {
  t: number;
  side: PulseSide;
  action: "entry" | "exit" | "reverse";
  price: number;
  owner: Owner;
  pnl?: number;
  closed?: { side: PulseSide; entry: number; exit: number };
};

type Outcome = { finalPrice: number; yourPnl: number; botPnl: number };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");
const sideColor = (side: PulseSide) => (side === "long" ? "var(--chart-up)" : "var(--chart-down)");
/** "1%", "0.1%", "0.01%": how far the price can move against each leverage. */
const distanceLabel = (leverage: number) => `${Number((100 / leverage).toPrecision(2))}%`;

const IDLE_LINE = "Ready when you are. The clock starts on your first trade.";

let nextId = 0;
const newPosition = (side: PulseSide, entryPrice: number, stake: number, leverage: number): PulsePosition => ({
  id: `tut-${++nextId}`,
  side,
  entryPrice,
  stake,
  leverage,
  openedAt: Date.now(),
});

export default function LiveRound({
  feed,
  muted,
  toggleMuted,
  playFeedback,
  onComplete,
}: {
  feed: Feed;
  muted: boolean;
  toggleMuted: () => void;
  playFeedback: (kind: "entry" | "exit" | "reverse") => void;
  onComplete: () => void;
}) {
  const { price, points, status, now, getLivePrice } = feed;
  const [phase, setPhase] = useState<Phase>("setup");
  const [position, setPosition] = useState<PulsePosition | null>(null);
  const [realized, setRealized] = useState(0);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stake, setStake] = useState(LIVE_DEFAULT_STAKE);
  const [leverage, setLeverage] = useState<number>(PULSE_LEVERAGE_OPTIONS[0]);
  const [roundStart, setRoundStart] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(LIVE_ROUND_SECONDS);
  const [peakPnl, setPeakPnl] = useState(0);
  const [lastClosedPnl, setLastClosedPnl] = useState<number | null>(null);
  const [liquidated, setLiquidated] = useState(false);
  const [bot, setBot] = useState<{ position: PulsePosition | null; realized: number }>({ position: null, realized: 0 });
  const [sibylLine, setSibylLine] = useState(IDLE_LINE);
  const [sibylLineKey, setSibylLineKey] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [isActing, setIsActing] = useState(false);
  const maxLeadRef = useRef(1);

  const positionRef = useRef(position);
  positionRef.current = position;
  const realizedRef = useRef(realized);
  realizedRef.current = realized;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const secondsLeftRef = useRef(secondsLeft);
  secondsLeftRef.current = secondsLeft;
  const botRef = useRef<BotMemory>({ position: null, peakPnl: 0, cooldownUntil: 0 });
  const botRealizedRef = useRef(0);
  const peakRef = useRef(0);

  const addTrade = (trade: Trade) => setTrades((current) => [...current, trade]);
  const say = useCallback((line: string) => {
    setSibylLine(line);
    setSibylLineKey((k) => k + 1);
  }, []);
  const lockBriefly = () => {
    setIsActing(true);
    window.setTimeout(() => setIsActing(false), 240);
  };

  const availableCash = Math.max(0, LIVE_STARTING_CASH + realized);
  const tradeStake = clampPulseStake(stake, availableCash);

  const openPosition = (next: PulsePosition) => {
    positionRef.current = next;
    setPosition(next);
    peakRef.current = 0;
    setPeakPnl(0);
    setLiquidated(false);
    setPhase("open");
  };

  const realize = (pnl: number) => {
    realizedRef.current += pnl;
    setRealized(realizedRef.current);
  };

  const closeBot = useCallback((exitPrice: number) => {
    const open = botRef.current.position;
    if (!open) return 0;
    const pnl = pulsePositionPnl(open, exitPrice);
    botRealizedRef.current += pnl;
    botRef.current = { position: null, peakPnl: 0, cooldownUntil: Date.now() + BOT_COOLDOWN_MS };
    setBot({ position: null, realized: botRealizedRef.current });
    setTrades((current) => [...current, { t: Date.now() + 1, side: open.side, action: "exit", price: exitPrice, owner: "sibyl", pnl }]);
    return pnl;
  }, []);

  const runBot = useCallback(() => {
    const live = getLivePrice();
    if (live === null) return;
    const memory = botRef.current;
    if (memory.position) memory.peakPnl = Math.max(memory.peakPnl, pulsePositionPnl(memory.position, live));
    const action = botDecide(memory, { price: live, points: pointsRef.current, now: Date.now(), secondsLeft: secondsLeftRef.current });
    if (action.kind === "enter") {
      const next = newPosition(action.side, live, BOT_STAKE, BOT_LEVERAGE);
      botRef.current = { position: next, peakPnl: 0, cooldownUntil: 0 };
      setBot({ position: next, realized: botRealizedRef.current });
      setTrades((current) => [...current, { t: Date.now(), side: action.side, action: "entry", price: live, owner: "sibyl" }]);
      say(action.side === "long" ? "Momentum's up. I'm going long." : "Looks heavy. I'm going short.");
    } else if (action.kind === "close") {
      const pnl = closeBot(live);
      say(
        action.reason === "stall"
          ? `Move stalled. Locking in ${signedUsd(pnl)}.`
          : action.reason === "bell"
            ? `Bell's close. Taking my ${signedUsd(pnl)}.`
            : `Not working. Cutting it at ${signedUsd(pnl)}.`,
      );
    }
  }, [getLivePrice, closeBot, say]);

  const enter = (side: PulseSide) => {
    if (phase !== "setup" || isActing) return;
    const live = getLivePrice();
    if (live === null || tradeStake <= 0) return;
    if (roundStart === null) {
      setRoundStart(Date.now());
      // Sibyl reads the same tape the moment the round starts.
      window.setTimeout(runBot, 0);
    }
    openPosition(newPosition(side, live, tradeStake, leverage));
    addTrade({ t: Date.now(), side, action: "entry", price: live, owner: "you" });
    playFeedback("entry");
    lockBriefly();
  };

  const close = () => {
    const current = positionRef.current;
    const live = getLivePrice();
    if (phase !== "open" || !current || live === null || isActing) return;
    const pnl = pulsePositionPnl(current, live);
    realize(pnl);
    positionRef.current = null;
    setPosition(null);
    setLastClosedPnl(pnl);
    setPhase("setup");
    addTrade({ t: Date.now(), side: current.side, action: "exit", price: live, owner: "you", pnl, closed: { side: current.side, entry: current.entryPrice, exit: live } });
    playFeedback("exit");
    lockBriefly();
  };

  const reverse = () => {
    const current = positionRef.current;
    const live = getLivePrice();
    if (phase !== "open" || !current || live === null || isActing) return;
    const pnl = pulsePositionPnl(current, live);
    realize(pnl);
    const nextSide: PulseSide = current.side === "long" ? "short" : "long";
    const nextStake = clampPulseStake(current.stake, Math.max(0, LIVE_STARTING_CASH + realizedRef.current));
    setLastClosedPnl(pnl);
    if (nextStake <= 0) {
      positionRef.current = null;
      setPosition(null);
      setPhase("setup");
    } else {
      openPosition(newPosition(nextSide, live, nextStake, current.leverage));
    }
    addTrade({ t: Date.now(), side: nextSide, action: "reverse", price: live, owner: "you", pnl, closed: { side: current.side, entry: current.entryPrice, exit: live } });
    playFeedback("reverse");
    lockBriefly();
  };

  // Liquidation (isolated margin, same rule as the ranked room): touching the
  // liquidation price closes the trade at exactly −stake.
  useEffect(() => {
    const current = positionRef.current;
    if (phase !== "open" || !current || price === null) return;
    const pnl = pulsePositionPnl(current, price);
    if (pnl > peakRef.current) {
      peakRef.current = pnl;
      setPeakPnl(pnl);
    }
    if (!pulseIsLiquidated(current, price)) return;
    const exitPrice = pulseLiquidationPrice(current);
    realize(-current.stake);
    positionRef.current = null;
    setPosition(null);
    setLastClosedPnl(-current.stake);
    setLiquidated(true);
    setPhase("setup");
    addTrade({ t: Date.now(), side: current.side, action: "exit", price: exitPrice, owner: "you", pnl: -current.stake, closed: { side: current.side, entry: current.entryPrice, exit: exitPrice } });
    playFeedback("exit");
  }, [price, phase, playFeedback]);

  const settle = useCallback(async () => {
    setPhase("settling");
    setSettleError(false);
    try {
      let finalPrice = getLivePrice();
      if (finalPrice === null) {
        const res = await fetch("/api/price?symbol=BTC-USD", { cache: "no-store" });
        if (!res.ok) throw new Error("price unavailable");
        finalPrice = ((await res.json()) as { price: number }).price;
      }
      const open = positionRef.current;
      if (open) {
        const pnl = pulsePositionPnl(open, finalPrice);
        realizedRef.current += pnl;
        setRealized(realizedRef.current);
        positionRef.current = null;
        setPosition(null);
        setTrades((current) => [
          ...current,
          { t: Date.now(), side: open.side, action: "exit", price: finalPrice, owner: "you", pnl, closed: { side: open.side, entry: open.entryPrice, exit: finalPrice } },
        ]);
      }
      closeBot(finalPrice);
      setFrozenPoints([...pointsRef.current, { t: Date.now(), p: finalPrice }]);
      setOutcome({ finalPrice, yourPnl: realizedRef.current, botPnl: botRealizedRef.current });
      setPhase("result");
    } catch {
      setSettleError(true);
    }
  }, [getLivePrice, closeBot]);

  // The round clock, plus Sibyl's once-a-second look at the tape.
  useEffect(() => {
    if (roundStart === null || phase === "settling" || phase === "result") return;
    const deadline = roundStart + LIVE_ROUND_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(clock);
        window.clearInterval(botClock);
        void settle();
      }
    };
    const clock = window.setInterval(tick, 200);
    const botClock = window.setInterval(runBot, 1000);
    tick();
    return () => {
      window.clearInterval(clock);
      window.clearInterval(botClock);
    };
  }, [roundStart, phase, settle, runBot]);

  useEffect(() => {
    if (phase !== "result" || !outcome) return;
    const won = outcome.botPnl > outcome.yourPnl + 0.005;
    say(won ? "That's my round. Run it back?" : outcome.yourPnl > outcome.botPnl + 0.005 ? "GG, you earned that one." : "Dead even. Rematch?");
  }, [phase, outcome, say]);

  const restart = () => {
    positionRef.current = null;
    realizedRef.current = 0;
    botRealizedRef.current = 0;
    botRef.current = { position: null, peakPnl: 0, cooldownUntil: 0 };
    peakRef.current = 0;
    maxLeadRef.current = 1;
    setPosition(null);
    setRealized(0);
    setTrades([]);
    setRoundStart(null);
    setSecondsLeft(LIVE_ROUND_SECONDS);
    setPeakPnl(0);
    setLastClosedPnl(null);
    setLiquidated(false);
    setBot({ position: null, realized: 0 });
    setOutcome(null);
    setSettleError(false);
    setFrozenPoints(null);
    setSibylLine(IDLE_LINE);
    setPhase("setup");
  };

  const livePositionPnl = position && price !== null ? pulsePositionPnl(position, price) : 0;
  const yourPnl = outcome ? outcome.yourPnl : realized + livePositionPnl;
  const botPnl = outcome ? outcome.botPnl : bot.realized + (bot.position && price !== null ? pulsePositionPnl(bot.position, price) : 0);
  const yourEquity = LIVE_STARTING_CASH + yourPnl;
  const botEquity = LIVE_STARTING_CASH + botPnl;
  const leadDelta = yourPnl - botPnl;
  maxLeadRef.current = Math.max(maxLeadRef.current, Math.abs(leadDelta));
  const leadSide = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "sibyl" : "tie";
  const winner = outcome ? (Math.abs(leadDelta) < 0.005 ? "tie" : leadDelta > 0 ? "you" : "rival") : null;
  const started = roundStart !== null;
  const canEnter = phase === "setup" && getLivePrice() !== null && tradeStake > 0 && !isActing;
  const canManage = phase === "open" && getLivePrice() !== null && !isActing;
  const tip = coachTip({ started, position, price, peakPnl, secondsLeft, lastClosedPnl, liquidated });

  const markers: TradeMarker[] = trades.map((trade) => ({
    t: trade.t,
    p: trade.price,
    side: trade.side,
    action: trade.action,
    owner: trade.owner,
    pnl: trade.pnl,
  }));

  return (
    <>
      <PulseMovementAlert total={yourEquity} />
      <section className="tut-card arena-panel">
        <p className="tut-kicker">
          Lesson {STEP_LABELS.length} of {STEP_LABELS.length} · Live round
        </p>
        <h2 className="tut-title">Live round vs Sibyl</h2>
        <p className="tut-body">
          Live Bitcoin prices, a real 60-second clock, and Sibyl, our practice bot, trading against you. You each start with <b>{usd(LIVE_STARTING_CASH)}</b>. Trade as often as you like; most money at the bell wins.
        </p>
        <p className="tut-key">
          Real Bitcoin moves far less than our lessons, often under 0.1% a minute, so leverage starts at <b>100×</b>. Same liquidation rule: at 100× a 1% move against you wipes you out. At 1,000×, just 0.1%.
        </p>
      </section>

      <section className="tut-stage">
        <div className="arena-panel rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <div className={`duel-avatar h-6 w-6 text-[10px] sm:h-8 sm:w-8 sm:text-xs ${leadSide === "you" ? "is-lead" : ""}`} style={{ backgroundImage: YOU_GRADIENT }} aria-hidden="true">
                Y
              </div>
              <ArenaScore name="You" equity={yourEquity} pnl={yourPnl} align="left" />
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[var(--muted-dim)]">VS</span>
              <CountdownRing seconds={secondsLeft} total={LIVE_ROUND_SECONDS} urgent={secondsLeft <= 10 && started} />
              <span className="text-[9px] uppercase tracking-wider text-[var(--muted)]">{started ? "Time left" : "Ready"}</span>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
              <ArenaScore name="Sibyl · AI" equity={botEquity} pnl={botPnl} align="right" />
              <div className={`duel-avatar h-6 w-6 sm:h-8 sm:w-8 ${leadSide === "sibyl" ? "is-lead" : ""}`} style={{ backgroundImage: RIVAL_GRADIENT }} aria-hidden="true">
                <SibylFace mood={leadSide === "sibyl" ? "happy" : leadSide === "you" ? "sad" : "neutral"} />
              </div>
            </div>
          </div>
          <LeadBar leadDelta={leadDelta} maxLead={maxLeadRef.current} rivalName="Sibyl" />
          <p key={sibylLineKey} className="sibyl-bubble mt-1.5 text-center text-[11px] text-[var(--muted)]">
            <span className="opacity-60">Sibyl:</span> {sibylLine}
          </p>
        </div>

        <div className="tut-live-price">
          <span className="tut-stage-label">{outcome ? "FINAL BTC / USD" : "BTC / USD"}</span>
          {!outcome && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-[var(--brand)]" : "bg-[var(--muted-dim)]"}`} />
              {status === "live" ? "live" : status}
            </span>
          )}
          <strong className="tabular-nums">
            <FlashingPrice price={outcome?.finalPrice ?? price} />
          </strong>
        </div>

        <PriceChart
          points={frozenPoints ?? points}
          trades={markers}
          roundStart={roundStart}
          frozen={frozenPoints !== null}
          openEntry={position ? { t: position.openedAt ?? 0, p: position.entryPrice, side: position.side } : null}
          now={now}
        />
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--muted-dim)]">
          <span>Entries ○ · exits □ · reversals ◇ · dashed = Sibyl</span>
          <SoundToggle muted={muted} onToggle={toggleMuted} />
        </div>
      </section>

      {/* Left column under the lesson card: the coach, then the controls. */}
      <div className="tut-controls">
        {phase !== "result" && (
          <p className={`tut-coach is-${tip.tone}`} aria-live="polite">
            <span className="tut-coach-label">Coach</span>
            {tip.text}
          </p>
        )}

        <section
          className={
            phase === "setup" || phase === "open"
              ? "arena-dock dock-bar mt-3"
              : "arena-dock mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
          }
        >
          {phase === "setup" && (
            <>
              {lastClosedPnl !== null && (
                <p className="dock-last-note">
                  {liquidated ? "Liquidated" : "Last trade"}:{" "}
                  <span style={{ color: pnlColor(lastClosedPnl) }}>{signedUsd(lastClosedPnl)}</span>
                </p>
              )}
              <div className="dock-row dock-row-wrap">
                <div className="dock-stake">
                  <PulseStakeStepper stake={tradeStake} availableCash={availableCash} disabled={false} onChange={setStake} />
                </div>
              </div>
              <div className="tut-choice is-compact" role="radiogroup" aria-label="Leverage">
                {PULSE_LEVERAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={leverage === option}
                    className={leverage === option ? "is-selected" : undefined}
                    onClick={() => setLeverage(option)}
                  >
                    <strong>{option.toLocaleString("en-US")}×</strong>
                    <span>wiped out by {distanceLabel(option)}</span>
                  </button>
                ))}
              </div>
              <div className="dock-row">
                {(["long", "short"] as const).map((side) => (
                  <button key={side} type="button" disabled={!canEnter} onClick={() => enter(side)} className={`dock-action is-${side}`}>
                    {side === "long" ? "↗ Long" : "↘ Short"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-center text-xs text-[var(--muted)]">
                {getLivePrice() === null
                  ? "Waiting for a live market connection…"
                  : availableCash <= 0
                    ? "You're out of practice money for this round."
                    : `Available ${usd(availableCash)} · ${started ? "press a side to enter at the live price" : "your first trade starts the clock"}`}
              </p>
            </>
          )}

          {phase === "open" && position && (
            <>
              <div className="dock-row">
                <span className="dock-chip" style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}>
                  {position.side.toUpperCase()}
                </span>
                <span className="dock-live-pnl dock-pnl-hero" style={{ color: pnlColor(livePositionPnl) }}>
                  {signedUsd(livePositionPnl)}
                </span>
                <span className="dock-meta">
                  <span>
                    {usd(position.entryPrice)} → {price !== null ? usd(price) : "—"}
                  </span>
                  <span>
                    {usd(position.stake)} · {position.leverage.toLocaleString("en-US")}×
                  </span>
                </span>
              </div>
              <div className="dock-row">
                <button type="button" disabled={!canManage} onClick={close} className={`dock-action is-${position.side}`}>
                  Close
                </button>
                <button type="button" disabled={!canManage} onClick={reverse} className="dock-action-secondary">
                  Reverse
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-[var(--muted)]">
                Reverse closes and flips sides. Liquidates at {usd(pulseLiquidationPrice(position))}. Best so far {signedUsd(peakPnl)}.
              </p>
            </>
          )}

          {phase === "settling" && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-[var(--muted)]">{settleError ? "Could not fetch the final price." : "Fetching final price…"}</p>
              {settleError && (
                <button
                  type="button"
                  onClick={() => void settle()}
                  className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {phase === "result" && outcome && winner && (
            <ArenaResultCard
              marketLabel="BTC"
              finalPrice={outcome.finalPrice}
              winner={winner}
              rivalName="Sibyl"
              rivalAvatar={<SibylFace mood={winner === "rival" ? "happy" : winner === "you" ? "sad" : "neutral"} />}
              yourEquity={yourEquity}
              yourPnl={outcome.yourPnl}
              rivalEquity={botEquity}
              rivalPnl={outcome.botPnl}
              trades={trades.filter((trade) => trade.owner === "you")}
              playAgain={
                <>
                  <button type="button" onClick={onComplete} className="tut-button-primary">
                    Finish tutorial <span aria-hidden="true">→</span>
                  </button>
                  <button type="button" onClick={restart} className="tut-button-secondary">
                    Play again
                  </button>
                </>
              }
            />
          )}
        </section>
      </div>
    </>
  );
}
