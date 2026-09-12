"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "../../../PriceChart";
import { usePriceFeed, type PricePoint } from "../../../usePriceFeed";

const ROUND_SECONDS = 60;
const STARTING_CASH = 100;
const DEFAULT_LEVERAGE = 25;
const LEVERAGE_OPTIONS = [1, 10, 25, 50, 75, 100];
const STAKE_OPTIONS = [10, 25, 50, 100];

const LONG_COLOR = "#0f9f76";
const SHORT_COLOR = "#e25562";

type Side = "long" | "short";
type Phase = "setup" | "open" | "closed" | "settling" | "result";

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

const formatTime = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

function SoundWave() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-4 w-4">
      <path d="M3 7v4h2.5L9 14V4L5.5 7H3Zm8.4 1.1a2.3 2.3 0 0 1 0 2.8M13.6 6a5.1 5.1 0 0 1 0 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [pressedAction, setPressedAction] = useState<Side | "close" | null>(null);
  const [rivalEntryPrice, setRivalEntryPrice] = useState<number | null>(null);
  const [rivalSide, setRivalSide] = useState<Side>("short");

  const priceRef = useRef(price);
  priceRef.current = price;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const positionRef = useRef(position);
  positionRef.current = position;
  const realizedPnlRef = useRef(realizedPnl);
  realizedPnlRef.current = realizedPnl;
  const leverageRef = useRef(leverage);
  leverageRef.current = leverage;

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
      setFrozenPoints([...pointsRef.current, { t: Date.now(), p: finalPrice }]);
      setOutcome({
        finalPrice,
        profit,
        finalValue: STARTING_CASH + profit,
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
    if (execPrice === null || !Number.isFinite(stake) || stake <= 0) return;

    const nextPosition: Position = {
      side,
      entryPrice: execPrice,
      stake: Math.min(stake, STARTING_CASH),
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
    setPhase("closed");
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

  const openNewPosition = () => {
    if (phase !== "closed") return;
    setPhase("setup");
  };

  const playAgain = () => {
    const initial = 0;
    positionRef.current = null;
    realizedPnlRef.current = initial;
    setPosition(null);
    setClosedPosition(null);
    setRealizedPnl(initial);
    setTrades([]);
    setStake(STARTING_CASH);
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
  const liveEquity = STARTING_CASH + liveTotalPnl;
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
  const canEnter = phase === "setup" && getLivePrice() !== null;
  const canManage = phase === "open" && getLivePrice() !== null;

  return (
    <main className="min-h-screen bg-[#f2f5f7] text-[#172126]">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-3 text-sm font-semibold tracking-tight text-[#172126]">
            <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#172126] text-[#f4d35e] shadow-sm transition-transform group-hover:-rotate-6">P</span>
            <span>Pulse Arena <span className="ml-1 font-normal text-[#87939a]">/ BTC-USD</span></span>
          </Link>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#87939a]">
            <span className={`h-2 w-2 rounded-full ${status === "live" ? "animate-pulse bg-[#0f9f76]" : "bg-[#e2aa3b]"}`} />
            {status === "live" ? "Live market" : status}
          </div>
        </header>

        <section className="mt-7 rounded-[22px] border border-[#dce4e8] bg-white p-3 shadow-[0_18px_55px_rgba(29,47,56,0.07)] sm:p-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[16px] bg-[#f5f7f8] px-3 py-3 sm:px-5">
            <Score name="YOU" equity={outcome ? outcome.finalValue : liveEquity} pnl={outcome?.profit ?? liveTotalPnl} tone="you" />
            <div className="flex min-w-[70px] flex-col items-center">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#9ba5aa]">Time left</span>
              <span className={`mt-0.5 rounded-full px-3 py-1 text-lg font-bold tabular-nums tracking-tight ${secondsLeft <= 10 && roundStart !== null ? "bg-[#ffe9e9] text-[#d6404c]" : "bg-[#172126] text-white"}`}>
                {formatTime(secondsLeft)}
              </span>
            </div>
            <Score name="NOVA · AI" equity={STARTING_CASH + rivalPnl} pnl={rivalPnl} tone="rival" />
          </div>

          <div className="mt-4 flex items-end justify-between px-1 sm:px-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#87939a]">
                <span>BTC / USD</span>
                {roundStart !== null && phase !== "result" && <span className="rounded-full bg-[#e5f6ef] px-2 py-0.5 text-[9px] tracking-[0.12em] text-[#0f9f76]">ROUND LIVE</span>}
              </div>
              <div className="mt-1 text-3xl font-semibold tracking-[-0.04em] tabular-nums sm:text-4xl">
                {headlinePrice === null ? "Loading..." : usd(headlinePrice)}
              </div>
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a3adb2]">Real-time spot price</p>
              <p className="mt-1 text-xs text-[#66747b]">BTC-USD · live feed</p>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-[16px] border border-[#e2e9ec] bg-[#fcfdfd]">
            <PriceChart points={frozenPoints ?? points} trades={tradeMarkers} roundStart={roundStart} frozen={frozenPoints !== null} now={now} />
          </div>
          <div className="flex items-center justify-between px-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a3adb2] sm:px-3">
            <span>Live BTC price action</span>
            <span className="flex items-center gap-1.5"><SoundWave /> Tactile mode</span>
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
          currentPrice={price}
          livePositionPnl={livePositionPnl}
          realizedPnl={realizedPnl}
          canEnter={canEnter}
          canManage={canManage}
          pressedAction={pressedAction}
          onEnter={enterPosition}
          onClose={closePosition}
          onReverse={reversePosition}
          onOpenNew={openNewPosition}
          onRetry={() => void settle()}
          settleError={settleError}
          outcome={outcome}
          onPlayAgain={playAgain}
        />
      </div>
    </main>
  );
}

function Score({ name, equity, pnl, tone }: { name: string; equity: number; pnl: number; tone: "you" | "rival" }) {
  const isPositive = pnl >= 0;
  return (
    <div className={`min-w-0 ${tone === "rival" ? "text-right" : "text-left"}`}>
      <div className={`flex items-center gap-2 ${tone === "rival" ? "justify-end" : ""}`}>
        {tone === "you" && <span className="h-2 w-2 rounded-full bg-[#f4d35e]" />}
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.15em] text-[#6f7c82]">{name}</span>
        {tone === "rival" && <span className="h-2 w-2 rounded-full bg-[#9ca8af]" />}
      </div>
      <div className="mt-1 text-base font-bold tabular-nums tracking-tight sm:text-lg">{usd(equity)}</div>
      <div className={`mt-0.5 text-[11px] font-semibold tabular-nums ${isPositive ? "text-[#0f9f76]" : "text-[#e25562]"}`}>{signedUsd(pnl)} P&L</div>
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
  currentPrice: number | null;
  livePositionPnl: number;
  realizedPnl: number;
  canEnter: boolean;
  canManage: boolean;
  pressedAction: Side | "close" | null;
  onEnter: (side: Side) => void;
  onClose: () => void;
  onReverse: () => void;
  onOpenNew: () => void;
  onRetry: () => void;
  settleError: boolean;
  outcome: Outcome | null;
  onPlayAgain: () => void;
};

function TradingDock(props: DockProps) {
  const {
    phase, stake, setStake, leverage, setLeverage, position, closedPosition,
    currentPrice, livePositionPnl, realizedPnl, canEnter, canManage,
    pressedAction, onEnter, onClose, onReverse, onOpenNew, onRetry,
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

  return (
    <section className="mt-5 rounded-[22px] border border-[#dce4e8] bg-white p-4 shadow-[0_15px_45px_rgba(29,47,56,0.06)] sm:p-5">
      <div className="flex items-center justify-between border-b border-[#edf1f2] pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9ba5aa]">Trading dock</p>
          <h2 className="mt-1 text-lg font-bold tracking-[-0.02em]">
            {phase === "setup" ? "Choose your move" : phase === "open" ? "Position in play" : phase === "closed" ? "Position closed" : phase === "result" ? "Round complete" : "Locking result"}
          </h2>
        </div>
        {phase === "setup" && <span className="rounded-full bg-[#fff7d8] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#927522]">Setup</span>}
        {phase === "open" && position && <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]" style={{ backgroundColor: `${sideColor(position.side)}16`, color: sideColor(position.side) }}>{position.side} open</span>}
        {phase === "closed" && <span className="rounded-full bg-[#f0f3f4] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#738087]">Flat</span>}
      </div>

      {phase === "setup" && (
        <div className="pt-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#87939a]">Stake</label>
                <span className="text-xs font-semibold tabular-nums text-[#55646b]">{usd(stake)}</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {STAKE_OPTIONS.map((option) => (
                  <button key={option} type="button" onClick={() => setStake(option)} className={`rounded-[10px] border px-2 py-2 text-xs font-bold tabular-nums transition-colors ${stake === option ? "border-[#172126] bg-[#172126] text-white" : "border-[#dce4e8] bg-white text-[#64727a] hover:border-[#9daab0]"}`}>
                    {option === 100 ? "All in" : usd(option)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#87939a]">Leverage</span>
              <div className="mt-2 flex gap-1.5 sm:justify-end">
                {LEVERAGE_OPTIONS.map((option) => (
                  <button key={option} type="button" onClick={() => setLeverage(option)} className={`min-w-9 rounded-[9px] px-2 py-2 text-xs font-bold tabular-nums transition-colors ${leverage === option ? "bg-[#f4d35e] text-[#172126]" : "bg-[#f2f5f6] text-[#718087] hover:bg-[#e7edef]"}`}>
                    {option}x
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-[#829097]">Press and hold a side to enter at the live market price.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" disabled={!canEnter} onPointerDown={() => press("long")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); press("long"); } }} className={`group relative min-h-[92px] overflow-hidden rounded-[16px] bg-[#0f9f76] px-4 py-4 text-left text-white shadow-[0_10px_20px_rgba(15,159,118,0.2)] transition duration-150 hover:-translate-y-0.5 hover:bg-[#0b8965] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#b7c7c3] ${pressedSide === "long" ? "scale-[0.98]" : ""}`}>
              <span className="absolute -right-4 -top-7 h-24 w-24 rounded-full border-[16px] border-white/10" />
              <span className="relative block text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Go</span>
              <span className="relative mt-1 block text-2xl font-bold tracking-[-0.04em]">Long <span className="text-white/60">↗</span></span>
            </button>
            <button type="button" disabled={!canEnter} onPointerDown={() => press("short")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); press("short"); } }} className={`group relative min-h-[92px] overflow-hidden rounded-[16px] bg-[#e25562] px-4 py-4 text-left text-white shadow-[0_10px_20px_rgba(226,85,98,0.18)] transition duration-150 hover:-translate-y-0.5 hover:bg-[#cc4654] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#d4b5b8] ${pressedSide === "short" ? "scale-[0.98]" : ""}`}>
              <span className="absolute -right-4 -top-7 h-24 w-24 rounded-full border-[16px] border-white/10" />
              <span className="relative block text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Go</span>
              <span className="relative mt-1 block text-2xl font-bold tracking-[-0.04em]">Short <span className="text-white/60">↘</span></span>
            </button>
          </div>
          {canEnter === false && <p className="mt-3 text-center text-xs text-[#b17d24]">Waiting for a live market connection...</p>}
        </div>
      )}

      {phase === "open" && position && (
        <div className="pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Direction" value={position.side.toUpperCase()} color={sideColor(position.side)} />
            <Metric label="Entry price" value={usd(position.entryPrice)} />
            <Metric label="Live P&L" value={signedUsd(livePositionPnl)} color={livePositionPnl >= 0 ? LONG_COLOR : SHORT_COLOR} />
            <Metric label="Size" value={`${usd(position.stake)} · ${position.leverage}x`} />
          </div>
          <div className="mt-4 grid grid-cols-[1.15fr_0.85fr] gap-3">
            <button type="button" disabled={!canManage} onClick={onClose} className={`min-h-[62px] rounded-[14px] bg-[#172126] px-4 text-left text-white transition hover:bg-[#2b3a40] active:scale-[0.98] disabled:bg-[#aeb9bd] ${pressedAction === "close" ? "scale-[0.98]" : ""}`}>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Take profit or cut loss</span>
              <span className="mt-1 block text-lg font-bold">Close position <span className="text-white/55">×</span></span>
            </button>
            <button type="button" disabled={!canManage} onClick={onReverse} className="min-h-[62px] rounded-[14px] border border-[#dce4e8] bg-white px-4 text-left text-[#172126] transition hover:border-[#9daab0] active:scale-[0.98] disabled:bg-[#f1f4f5] disabled:text-[#aeb9bd]">
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#87939a]">Switch bias</span>
              <span className="mt-1 block text-lg font-bold">Reverse <span className="text-[#87939a]">↔</span></span>
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-[#829097]">Your next action executes immediately at the live market price.</p>
        </div>
      )}

      {phase === "closed" && closedPosition && (
        <div className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: sideColor(closedPosition.side) }}>
              {closedPosition.side} closed <span className="text-[#a2adb2]">·</span> {usd(closedPosition.exitPrice)}
            </div>
            <p className={`mt-1 text-2xl font-bold tracking-[-0.04em] tabular-nums ${closedPosition.pnl >= 0 ? "text-[#0f9f76]" : "text-[#e25562]"}`}>{signedUsd(closedPosition.pnl)} <span className="text-sm font-semibold text-[#87939a]">realized</span></p>
          </div>
          <button type="button" onClick={onOpenNew} className="rounded-[13px] bg-[#f4d35e] px-5 py-3 text-sm font-bold text-[#172126] transition hover:bg-[#e9c94d] active:scale-[0.98]">Open another position <span className="ml-1">→</span></button>
        </div>
      )}

      {phase === "settling" && (
        <div className="flex items-center justify-between gap-4 pt-4">
          <p className="text-sm font-medium text-[#66747b]">{settleError ? "The final tick is taking a moment." : "Locking the final market price..."}</p>
          {settleError && <button type="button" onClick={onRetry} className="rounded-[10px] bg-[#172126] px-4 py-2 text-xs font-bold text-white">Retry</button>}
        </div>
      )}

      {phase === "result" && outcome && (
        <div className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#87939a]">Round result · final BTC {usd(outcome.finalPrice)}</p>
            <p className={`mt-1 text-3xl font-bold tracking-[-0.05em] tabular-nums ${outcome.profit >= 0 ? "text-[#0f9f76]" : "text-[#e25562]"}`}>{outcome.profit >= 0 ? "You won" : "Round loss"} <span className="text-xl">{signedUsd(outcome.profit)}</span></p>
            <p className="mt-1 text-xs text-[#829097]">Final equity {usd(outcome.finalValue)} · {realizedPnl === 0 ? "Position was flat" : "Includes realized P&L"}</p>
          </div>
          <button type="button" onClick={onPlayAgain} className="rounded-[13px] bg-[#172126] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#2b3a40] active:scale-[0.98]">Play again <span className="ml-1 text-[#f4d35e]">↗</span></button>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[12px] bg-[#f5f7f8] px-3 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ba5aa]">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}
