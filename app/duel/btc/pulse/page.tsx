"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "../../../PriceChart";
import { usePriceFeed, type PricePoint } from "../../../usePriceFeed";
import PulseMovementAlert from "../../../PulseMovementAlert";

const ROUND_SECONDS = 60;
const STARTING_CASH = 100;
const DEFAULT_LEVERAGE = 100;
const LEVERAGE_OPTIONS = [100, 1000, 10000];
const FIXED_STAKE_OPTIONS = [10, 25, 50];

// Long/short share the chart's own up/down tokens, so a marker on the plot is
// the same colour as the control that placed it.
const LONG_COLOR = "var(--chart-up)";
const SHORT_COLOR = "var(--chart-down)";

type Side = "long" | "short";
type Phase = "setup" | "open" | "settling" | "result";

type Position = {
  side: Side;
  entryPrice: number;
  stake: number;
  leverage: number;
  openedAt: number;
};

type Trade = {
  t: number;
  side: Side;
  action: "entry" | "exit" | "reverse";
  price: number;
  amount: number;
};

type ClosedPosition = {
  side: Side;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
};

type Outcome = {
  finalPrice: number;
  profit: number;
  finalValue: number;
};

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;

const positionPnl = (position: Position, price: number) => {
  const move =
    position.side === "long"
      ? price - position.entryPrice
      : position.entryPrice - price;
  return position.stake * (move / position.entryPrice) * position.leverage;
};

const sideColor = (side: Side) => (side === "long" ? LONG_COLOR : SHORT_COLOR);

const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");

const formatTime = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

function SoundWave() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-3.5 w-3.5">
      <path
        d="M3 7v4h2.5L9 14V4L5.5 7H3Zm8.4 1.1a2.3 2.3 0 0 1 0 2.8M13.6 6a5.1 5.1 0 0 1 0 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Page() {
  const { price, points, status, now, getLivePrice } = usePriceFeed();
  const [phase, setPhase] = useState<Phase>("setup");
  const [position, setPosition] = useState<Position | null>(null);
  const [closedPosition, setClosedPosition] = useState<ClosedPosition | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stake, setStake] = useState(STARTING_CASH);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [roundStart, setRoundStart] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [realizedPnl, setRealizedPnl] = useState(0);
  const [bankroll, setBankroll] = useState(STARTING_CASH);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [pressedAction, setPressedAction] = useState<Side | "close" | null>(null);
  const [rivalEntryPrice, setRivalEntryPrice] = useState<number | null>(null);
  const [rivalSide, setRivalSide] = useState<Side>("short");
  const [isPractice, setIsPractice] = useState(false);

  const priceRef = useRef(price);
  priceRef.current = price;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const positionRef = useRef(position);
  positionRef.current = position;
  const realizedPnlRef = useRef(realizedPnl);
  realizedPnlRef.current = realizedPnl;
  const bankrollRef = useRef(bankroll);
  bankrollRef.current = bankroll;

  const playFeedback = useCallback((kind: "entry" | "exit" | "reverse") => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "reverse" ? [12, 24, 12] : 12);
    }
    if (typeof window === "undefined") return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = kind === "reverse" ? 520 : kind === "entry" ? 410 : 260;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
      window.setTimeout(() => void context.close(), 150);
    } catch {
      // Audio is a progressive enhancement; the interaction stays functional.
    }
  }, []);

  useEffect(() => {
    setIsPractice(new URLSearchParams(window.location.search).get("practice") === "1");
  }, []);

  useEffect(() => {
    setDisplayPrice(getLivePrice() ?? priceRef.current);
    const id = setInterval(() => {
      setDisplayPrice(getLivePrice() ?? priceRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [getLivePrice]);

  const settle = useCallback(async () => {
    setPhase("settling");
    setSettleError(false);
    try {
      let finalPrice = getLivePrice();
      if (finalPrice === null) {
        const res = await fetch("/api/price", { cache: "no-store" });
        if (!res.ok) throw new Error("price unavailable");
        finalPrice = ((await res.json()) as { price: number }).price;
      }

      const openPnl = positionRef.current
        ? positionPnl(positionRef.current, finalPrice)
        : 0;
      const profit = realizedPnlRef.current + openPnl;
      const finalValue = Math.max(0, bankrollRef.current + profit);
      const openPosition = positionRef.current;
      if (openPosition) {
        setClosedPosition({
          side: openPosition.side,
          entryPrice: openPosition.entryPrice,
          exitPrice: finalPrice,
          pnl: openPnl,
        });
        addTrade({
          t: Date.now(),
          side: openPosition.side,
          action: "exit",
          price: finalPrice,
          amount: openPosition.stake,
        });
      }
      positionRef.current = null;
      setPosition(null);
      bankrollRef.current = finalValue;
      setBankroll(finalValue);
      setFrozenPoints([...pointsRef.current, { t: Date.now(), p: finalPrice }]);
      setOutcome({
        finalPrice,
        profit,
        finalValue,
      });
      setPhase("result");
    } catch {
      setSettleError(true);
      setPhase("settling");
    }
  }, [getLivePrice]);

  useEffect(() => {
    if (roundStart === null || phase === "result" || phase === "settling") return;

    const deadline = roundStart + ROUND_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        void settle();
      }
    };

    const id = setInterval(tick, 200);
    tick();
    return () => clearInterval(id);
  }, [phase, roundStart, settle]);

  const beginRound = (entryPrice: number) => {
    if (roundStart !== null) return;
    setRoundStart(Date.now());
    setRivalEntryPrice(entryPrice);
    setRivalSide(entryPrice % 2 > 1 ? "long" : "short");
  };

  const addTrade = (trade: Trade) => setTrades((current) => [...current, trade]);

  const enterPosition = (side: Side) => {
    if (phase !== "setup") return;
    const execPrice = getLivePrice();
    const availableCash = Math.max(0, bankrollRef.current + realizedPnlRef.current);
    if (execPrice === null || !Number.isFinite(stake) || stake <= 0 || availableCash <= 0) return;

    const nextPosition: Position = {
      side,
      entryPrice: execPrice,
      stake: Math.min(stake, availableCash),
      leverage,
      openedAt: Date.now(),
    };
    beginRound(execPrice);
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    setClosedPosition(null);
    setPhase("open");
    addTrade({ t: nextPosition.openedAt, side, action: "entry", price: execPrice, amount: nextPosition.stake });
    playFeedback("entry");
  };

  const closePosition = () => {
    if (phase !== "open" || positionRef.current === null) return;
    const execPrice = getLivePrice();
    if (execPrice === null) return;

    const current = positionRef.current;
    const pnl = positionPnl(current, execPrice);
    const closed = { side: current.side, entryPrice: current.entryPrice, exitPrice: execPrice, pnl };
    realizedPnlRef.current += pnl;
    setRealizedPnl(realizedPnlRef.current);
    setClosedPosition(closed);
    positionRef.current = null;
    setPosition(null);
    setPhase("setup");
    addTrade({ t: Date.now(), side: current.side, action: "exit", price: execPrice, amount: current.stake });
    setPressedAction("close");
    window.setTimeout(() => setPressedAction(null), 240);
    playFeedback("exit");
  };

  const reversePosition = () => {
    if (phase !== "open" || positionRef.current === null) return;
    const execPrice = getLivePrice();
    if (execPrice === null) return;

    const current = positionRef.current;
    const closedPnl = positionPnl(current, execPrice);
    const nextSide: Side = current.side === "long" ? "short" : "long";
    const nextPosition: Position = {
      side: nextSide,
      entryPrice: execPrice,
      stake: current.stake,
      leverage: current.leverage,
      openedAt: Date.now(),
    };
    realizedPnlRef.current += closedPnl;
    setRealizedPnl(realizedPnlRef.current);
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    setClosedPosition(null);
    addTrade({ t: nextPosition.openedAt, side: nextSide, action: "reverse", price: execPrice, amount: nextPosition.stake });
    playFeedback("reverse");
  };

  const playAgain = () => {
    const initial = 0;
    // Only busted players get a fresh $100 — otherwise the bankroll carries
    // over from the last round so losses actually stick.
    const nextBankroll = bankrollRef.current <= 0 ? STARTING_CASH : bankrollRef.current;
    bankrollRef.current = nextBankroll;
    setBankroll(nextBankroll);
    positionRef.current = null;
    realizedPnlRef.current = initial;
    setPosition(null);
    setClosedPosition(null);
    setRealizedPnl(initial);
    setTrades([]);
    setStake(Math.min(STARTING_CASH, nextBankroll));
    setLeverage(DEFAULT_LEVERAGE);
    setRoundStart(null);
    setSecondsLeft(ROUND_SECONDS);
    setOutcome(null);
    setSettleError(false);
    setFrozenPoints(null);
    setRivalEntryPrice(null);
    setPhase("setup");
  };

  const livePositionPnl =
    position && price !== null ? positionPnl(position, price) : 0;
  const liveTotalPnl = realizedPnl + livePositionPnl;
  const liveEquity = bankroll + liveTotalPnl;
  const rivalPnl =
    rivalEntryPrice !== null && price !== null
      ? positionPnl(
          { side: rivalSide, entryPrice: rivalEntryPrice, stake: 48, leverage: 10, openedAt: 0 },
          price,
        )
      : 0;
  const headlinePrice = outcome?.finalPrice ?? displayPrice;
  const tradeMarkers: TradeMarker[] = trades.map((trade) => ({
    t: trade.t,
    p: trade.price,
    side: trade.side,
    action: trade.action,
  }));
  const availableCash = Math.max(0, bankroll + realizedPnl);
  const isBusted = phase === "setup" && availableCash <= 0;
  const canEnter = phase === "setup" && getLivePrice() !== null && availableCash > 0;
  const canManage = phase === "open" && getLivePrice() !== null;

  useEffect(() => {
    if (stake > availableCash && availableCash > 0) {
      setStake(availableCash);
    }
  }, [availableCash, stake]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <PulseMovementAlert total={liveEquity} />
      <Link
        href="/duel"
        className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
      >
        ← Menu
      </Link>

      <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        BTC {isPractice ? "Practice" : "Arena"} · Pulse
      </h1>

      {/* Scoreboard: you, the clock, the AI rival */}
      <section className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4">
        <Score
          name="You"
          equity={outcome ? outcome.finalValue : liveEquity}
          pnl={outcome?.profit ?? liveTotalPnl}
          align="left"
        />
        <div className="flex min-w-20 flex-col items-center">
          <span className="text-xs uppercase tracking-wider text-[var(--muted)]">
            Time left
          </span>
          <span
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              secondsLeft <= 10 && roundStart !== null
                ? "text-[var(--accent-strong)]"
                : "text-[var(--text)]"
            }`}
          >
            {formatTime(secondsLeft)}
          </span>
        </div>
        <Score
          name="Sibyl · AI"
          equity={STARTING_CASH + rivalPnl}
          pnl={rivalPnl}
          align="right"
        />
      </section>

      {/* BTC price + feed status, centered like Quick Play */}
      <section className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            {outcome ? "Final BTC / USD" : "BTC / USD"}
          </p>
          {!outcome && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "live"
                    ? "animate-pulse bg-[var(--accent)]"
                    : "bg-[var(--muted-dim)]"
                }`}
              />
              {status === "live" ? "live" : status}
            </span>
          )}
          {roundStart !== null && phase !== "result" && (
            <span className="text-xs uppercase tracking-wider text-[var(--accent)]">
              · round live
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-semibold tabular-nums text-[var(--text)]">
          {headlinePrice === null ? "Loading…" : usd(headlinePrice)}
        </p>
      </section>

      <section className="mt-4">
        <PriceChart
          points={frozenPoints ?? points}
          trades={tradeMarkers}
          roundStart={roundStart}
          frozen={frozenPoints !== null}
          now={now}
        />
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--muted-dim)]">
          <span>Entries ○ · exits □ · reversals ◇</span>
          <span className="flex items-center gap-1.5">
            <SoundWave /> Tactile mode
          </span>
        </div>
      </section>

      <TradingDock
        phase={phase}
        stake={stake}
        setStake={setStake}
        leverage={leverage}
        setLeverage={setLeverage}
        position={position}
        closedPosition={closedPosition}
        livePrice={price}
        livePositionPnl={livePositionPnl}
        realizedPnl={realizedPnl}
        balance={liveEquity}
        availableCash={availableCash}
        isBusted={isBusted}
        canEnter={canEnter}
        canManage={canManage}
        pressedAction={pressedAction}
        onEnter={enterPosition}
        onClose={closePosition}
        onReverse={reversePosition}
        onRetry={() => void settle()}
        settleError={settleError}
        outcome={outcome}
        onPlayAgain={playAgain}
      />
    </main>
  );
}

function Score({
  name,
  equity,
  pnl,
  align,
}: {
  name: string;
  equity: number;
  pnl: number;
  align: "left" | "right";
}) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <div
        className={`flex items-center gap-2 ${align === "right" ? "justify-end" : ""}`}
      >
        <span className="truncate text-xs uppercase tracking-wider text-[var(--muted)]">
          {name}
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--text)]">
        {usd(equity)}
      </div>
      <div
        className="mt-0.5 text-xs font-medium tabular-nums"
        style={{ color: pnlColor(pnl) }}
      >
        {signedUsd(pnl)} P&amp;L
      </div>
    </div>
  );
}

type DockProps = {
  phase: Phase;
  stake: number;
  setStake: (value: number) => void;
  leverage: number;
  setLeverage: (value: number) => void;
  position: Position | null;
  closedPosition: ClosedPosition | null;
  livePrice: number | null;
  livePositionPnl: number;
  realizedPnl: number;
  balance: number;
  availableCash: number;
  isBusted: boolean;
  canEnter: boolean;
  canManage: boolean;
  pressedAction: Side | "close" | null;
  onEnter: (side: Side) => void;
  onClose: () => void;
  onReverse: () => void;
  onRetry: () => void;
  settleError: boolean;
  outcome: Outcome | null;
  onPlayAgain: () => void;
};

function TradingDock(props: DockProps) {
  const {
    phase, stake, setStake, leverage, setLeverage, position, closedPosition,
    livePrice, livePositionPnl, realizedPnl, balance, availableCash, isBusted, canEnter, canManage,
    pressedAction, onEnter, onClose, onReverse, onRetry,
    settleError, outcome, onPlayAgain,
  } = props;
  const [pressedSide, setPressedSide] = useState<Side | null>(null);

  const press = (side: Side) => {
    setPressedSide(side);
    onEnter(side);
    window.setTimeout(() => {
      setPressedSide(null);
    }, 180);
  };

  const heading =
    phase === "setup"
      ? "Choose your move"
      : phase === "open"
        ? "Position in play"
        : phase === "result"
          ? "Round complete"
          : "Locking result";

  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[var(--line)] pb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            Trading dock
          </p>
          <h2 className="mt-1 font-medium text-[var(--text)]">{heading}</h2>
        </div>
        <div className="text-center">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            Balance
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--accent-strong)]">
            {usd(balance)}
          </p>
        </div>
        <div className="flex justify-end">
          {phase === "open" && position ? (
            <span
              className="rounded-md border px-2.5 py-1 text-xs uppercase tracking-wider"
              style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}
            >
              {position.side} open
            </span>
          ) : (
            <span className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs uppercase tracking-wider text-[var(--muted)]">
              {phase === "setup" ? "Setup" : "Settling"}
            </span>
          )}
        </div>
      </div>

      {phase === "setup" && (
        <div className="pt-4">
          {closedPosition && (
            <p className="mb-4 text-center text-xs text-[var(--muted)]">
              Last:{" "}
              <span style={{ color: sideColor(closedPosition.side) }}>
                {closedPosition.side}
              </span>{" "}
              closed @ {usd(closedPosition.exitPrice)} ·{" "}
              <span style={{ color: pnlColor(closedPosition.pnl) }}>
                {signedUsd(closedPosition.pnl)}
              </span>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Stake
                </span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {usd(Math.min(stake, availableCash))}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {FIXED_STAKE_OPTIONS.map((option) => {
                  const affordable = option <= availableCash;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={!affordable}
                      onClick={() => setStake(option)}
                      className={`rounded-md border py-1.5 text-xs font-medium tabular-nums transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        stake === option
                          ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]"
                          : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      {usd(option)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={availableCash <= 0}
                  onClick={() => setStake(availableCash)}
                  className={`rounded-md border py-1.5 text-xs font-medium tabular-nums transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    stake === availableCash
                      ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  All in
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-[var(--muted)]">
                  Leverage
                </span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {leverage}×
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {LEVERAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setLeverage(option)}
                    className={`rounded-md border py-1.5 text-xs font-medium tabular-nums transition ${
                      leverage === option
                        ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]"
                        : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    {option}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {(["long", "short"] as const).map((side) => (
              <button
                key={side}
                type="button"
                disabled={!canEnter}
                onPointerDown={() => press(side)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    press(side);
                  }
                }}
                style={
                  canEnter
                    ? { backgroundColor: sideColor(side), color: "var(--accent-contrast)" }
                    : undefined
                }
                className={`rounded-lg px-3 py-2.5 text-left transition disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)] ${
                  pressedSide === side ? "scale-[0.98]" : ""
                }`}
              >
                <span className="block text-xl font-semibold">
                  {side === "long" ? "Long ↗" : "Short ↘"}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            {isBusted
              ? "You're out of funds for this session."
              : canEnter
                ? "Press a side to enter at the live market price."
                : "Waiting for a live market connection…"}
          </p>
          {isBusted && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={onPlayAgain}
                className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
              >
                Reset & play again
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "open" && position && (
        <div className="pt-4">
          <div className="grid grid-cols-[0.7fr_1.6fr_0.7fr_1fr] gap-2">
            <Metric
              compact
              label="Direction"
              value={position.side.toUpperCase()}
              color={sideColor(position.side)}
            />
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2.5">
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
                Entry / Current
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate font-medium tabular-nums text-[var(--text)]">
                  {usd(position.entryPrice)}
                </span>
                <span className="text-[var(--muted-dim)]">→</span>
                <span className="truncate font-medium tabular-nums text-[var(--text)]">
                  {livePrice !== null ? usd(livePrice) : "—"}
                </span>
              </div>
            </div>
            <Metric
              compact
              label="Live P&L"
              value={signedUsd(livePositionPnl)}
              color={pnlColor(livePositionPnl)}
            />
            <Metric
              label="Size"
              value={`${usd(position.stake)} · ${position.leverage}×`}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canManage}
              onClick={onClose}
              className={`rounded-md bg-[var(--btn-bg)] px-4 py-3 text-left text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)] disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)] ${
                pressedAction === "close" ? "scale-[0.98]" : ""
              }`}
            >
              <span className="block text-xs uppercase tracking-wider opacity-70">
                Take profit or cut loss
              </span>
              <span className="mt-0.5 block font-medium">Close position ×</span>
            </button>
            <button
              type="button"
              disabled={!canManage}
              onClick={onReverse}
              className="rounded-md border border-[var(--line)] px-4 py-3 text-left text-[var(--text)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] disabled:text-[var(--btn-disabled-text)]"
            >
              <span className="block text-xs uppercase tracking-wider text-[var(--muted)]">
                Switch bias
              </span>
              <span className="mt-0.5 block font-medium">Reverse ↔</span>
            </button>
          </div>
          <p className="mt-3 text-center text-sm text-[var(--muted)]">
            Your next action executes immediately at the live market price.
          </p>
        </div>
      )}

      {phase === "settling" && (
        <div className="flex items-center justify-between gap-4 pt-4">
          <p className="text-sm text-[var(--muted)]">
            {settleError
              ? "Could not fetch the final price."
              : "Fetching final price…"}
          </p>
          {settleError && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {phase === "result" && outcome && (
        <div className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
              Round result · final BTC {usd(outcome.finalPrice)}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
              {outcome.profit >= 0 ? "You won" : "Round loss"}{" "}
              <span style={{ color: pnlColor(outcome.profit) }}>
                {signedUsd(outcome.profit)}
              </span>
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Final equity {usd(outcome.finalValue)} ·{" "}
              {realizedPnl === 0 ? "Position was flat" : "Includes realized P&L"}
            </p>
          </div>
          <button
            type="button"
            onClick={onPlayAgain}
            className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
          >
            Play Again
          </button>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  color,
  compact,
}: {
  label: string;
  value: string;
  color?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-[var(--line)] bg-[var(--surface-raised)] ${
        compact ? "px-2 py-2" : "px-3 py-2.5"
      }`}
    >
      <p className="truncate text-xs uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p
        className="mt-1 truncate font-medium tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
