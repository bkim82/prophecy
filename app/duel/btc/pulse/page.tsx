"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "../../../PriceChart";
import { usePriceFeed, type PricePoint } from "../../../usePriceFeed";
import PulseMovementAlert from "../../../PulseMovementAlert";
import PulseMarketTitle from "../../../PulseMarketTitle";
import {
  ArenaResultCard,
  ArenaScore,
  CountdownRing,
  FlashingPrice,
  LeadBar,
  RIVAL_GRADIENT,
  SoundToggle,
  usePulseFeedback,
  YOU_GRADIENT,
} from "../../../PulseArenaParts";
import { productForMarket } from "@/lib/spotPrice";

const ROUND_SECONDS = 60;
const STARTING_CASH = 100;
const DEFAULT_LEVERAGE = 100;
const LEVERAGE_OPTIONS = [100, 1000, 10000];
const FIXED_STAKE_OPTIONS = [10, 25, 50];
const RIVAL_STAKE = 48;
const RIVAL_LEVERAGE = 10;

// Long/short share the chart's own up/down tokens, so a marker on the plot is
// the same colour as the control that placed it.
const LONG_COLOR = "var(--chart-up)";
const SHORT_COLOR = "var(--chart-down)";

// Each line a short, grounded reaction to a real state change — never a
// claim about activity that didn't happen.
const ROUND_START_LINES = ["Let's see what you've got.", "Game on.", "Show me your edge."];
const LEAD_TAKEN_LINES = ["I'm reading the tape well right now.", "This one's mine for now.", "Running the numbers my way."];
const LEAD_LOST_LINES = ["Hm, recalibrating.", "Not bad — yet.", "You got the better entry there."];
const URGENT_LINES = ["Clock's ticking.", "Final stretch.", "Make it count."];
const RESULT_WIN_LINES = ["Analysis complete: I had the edge.", "That's the round."];
const RESULT_LOSS_LINES = ["GG. Run it again?", "You earned that one."];
const RESULT_TIE_LINES = ["A wash. Let's go again.", "Dead even — rematch?"];
const IDLE_LINE = "I'm waiting for a clearer move.";

type Side = "long" | "short";
type Phase = "setup" | "open" | "settling" | "result";
type Owner = "you" | "sibyl";

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
  owner: Owner;
  pnl?: number;
  /** On exit/reverse: the position this closed (the result card's trade review). */
  closed?: { side: Side; entry: number; exit: number };
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

type Winner = "you" | "sibyl" | "tie";

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

function SibylFace({ mood }: { mood: "happy" | "sad" | "neutral" }) {
  return (
    <svg viewBox="0 0 40 40" className="h-6 w-6" aria-hidden="true">
      <circle cx="14" cy="17" r="2.4" fill="#fff" />
      <circle cx="26" cy="17" r="2.4" fill="#fff" />
      <path
        className="sibyl-face-mouth"
        d="M13 25 Q20 30 27 25"
        stroke="#fff"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        style={{ opacity: mood === "happy" ? 1 : 0 }}
      />
      <path
        className="sibyl-face-mouth"
        d="M13 27 Q20 22 27 27"
        stroke="#fff"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        style={{ opacity: mood === "sad" ? 1 : 0 }}
      />
      <line
        className="sibyl-face-mouth"
        x1="13"
        y1="26"
        x2="27"
        y2="26"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        style={{ opacity: mood === "neutral" ? 1 : 0 }}
      />
    </svg>
  );
}

export default function Page() {
  // `?market=eth` reuses this solo loop for any priced market; BTC otherwise.
  const [market, setMarket] = useState("btc");
  const product = productForMarket(market) ?? "BTC-USD";
  const marketLabel = market.toUpperCase();
  const { price, points, status, now, getLivePrice } = usePriceFeed(product);
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
  const [rivalFinalPnl, setRivalFinalPnl] = useState<number | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [pressedAction, setPressedAction] = useState<Side | "close" | null>(null);
  const [rivalEntryPrice, setRivalEntryPrice] = useState<number | null>(null);
  const [rivalSide, setRivalSide] = useState<Side>("short");
  const [isPractice, setIsPractice] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [leadPulse, setLeadPulse] = useState<{ side: "you" | "sibyl"; key: number } | null>(null);
  const [sibylLine, setSibylLine] = useState(IDLE_LINE);
  const [sibylLineKey, setSibylLineKey] = useState(0);
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
  const rivalEntryPriceRef = useRef(rivalEntryPrice);
  rivalEntryPriceRef.current = rivalEntryPrice;
  const rivalSideRef = useRef(rivalSide);
  rivalSideRef.current = rivalSide;
  const { muted, toggleMuted, playFeedback } = usePulseFeedback();
  const isActingRef = useRef(isActing);
  isActingRef.current = isActing;
  const maxLeadRef = useRef(1);
  const prevLeadSideRef = useRef<"you" | "sibyl" | "tie">("tie");
  const firedUrgentRef = useRef(false);

  const sayLine = useCallback((lines: string[]) => {
    setSibylLine(lines[Math.floor(Math.random() * lines.length)]);
    setSibylLineKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setIsPractice(query.get("practice") === "1");
    const requested = query.get("market");
    if (requested && productForMarket(requested)) setMarket(requested);
  }, []);

  useEffect(() => {
    setDisplayPrice(getLivePrice() ?? priceRef.current);
    const id = setInterval(() => {
      setDisplayPrice(getLivePrice() ?? priceRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [getLivePrice]);

  const addTrade = (trade: Trade) => setTrades((current) => [...current, trade]);

  const settle = useCallback(async () => {
    setPhase("settling");
    setSettleError(false);
    try {
      let finalPrice = getLivePrice();
      if (finalPrice === null) {
        const res = await fetch(`/api/price?symbol=${product}`, { cache: "no-store" });
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
          owner: "you",
          pnl: openPnl,
          closed: { side: openPosition.side, entry: openPosition.entryPrice, exit: finalPrice },
        });
      }
      positionRef.current = null;
      setPosition(null);
      bankrollRef.current = finalValue;
      setBankroll(finalValue);
      setFrozenPoints([...pointsRef.current, { t: Date.now(), p: finalPrice }]);

      const rivalEntry = rivalEntryPriceRef.current;
      const finalRivalPnl =
        rivalEntry !== null
          ? positionPnl(
              { side: rivalSideRef.current, entryPrice: rivalEntry, stake: RIVAL_STAKE, leverage: RIVAL_LEVERAGE, openedAt: 0 },
              finalPrice,
            )
          : 0;
      setRivalFinalPnl(finalRivalPnl);
      if (rivalEntry !== null) {
        addTrade({
          t: Date.now() + 1,
          side: rivalSideRef.current,
          action: "exit",
          price: finalPrice,
          amount: RIVAL_STAKE,
          owner: "sibyl",
          pnl: finalRivalPnl,
        });
      }

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
  }, [getLivePrice, product]);

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
    const start = Date.now();
    const side: Side = entryPrice % 2 > 1 ? "long" : "short";
    setRoundStart(start);
    setRivalEntryPrice(entryPrice);
    setRivalSide(side);
    addTrade({ t: start, side, action: "entry", price: entryPrice, amount: RIVAL_STAKE, owner: "sibyl" });
    sayLine(ROUND_START_LINES);
  };

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
    addTrade({ t: nextPosition.openedAt, side, action: "entry", price: execPrice, amount: nextPosition.stake, owner: "you" });
    playFeedback("entry");
  };

  const closePosition = () => {
    if (phase !== "open" || positionRef.current === null || isActingRef.current) return;
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
    addTrade({
      t: Date.now(), side: current.side, action: "exit", price: execPrice, amount: current.stake, owner: "you", pnl,
      closed: { side: current.side, entry: current.entryPrice, exit: execPrice },
    });
    setPressedAction("close");
    isActingRef.current = true;
    setIsActing(true);
    window.setTimeout(() => {
      setPressedAction(null);
      isActingRef.current = false;
      setIsActing(false);
    }, 240);
    playFeedback("exit");
  };

  const reversePosition = () => {
    if (phase !== "open" || positionRef.current === null || isActingRef.current) return;
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
    addTrade({
      t: nextPosition.openedAt,
      side: nextSide,
      action: "reverse",
      price: execPrice,
      amount: nextPosition.stake,
      owner: "you",
      pnl: closedPnl,
      closed: { side: current.side, entry: current.entryPrice, exit: execPrice },
    });
    isActingRef.current = true;
    setIsActing(true);
    window.setTimeout(() => {
      isActingRef.current = false;
      setIsActing(false);
    }, 240);
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
    setRivalFinalPnl(null);
    setSettleError(false);
    setFrozenPoints(null);
    setRivalEntryPrice(null);
    maxLeadRef.current = 1;
    prevLeadSideRef.current = "tie";
    firedUrgentRef.current = false;
    setSibylLine(IDLE_LINE);
    setSibylLineKey(0);
    setPhase("setup");
  };

  const livePositionPnl =
    position && price !== null ? positionPnl(position, price) : 0;
  const liveTotalPnl = realizedPnl + livePositionPnl;
  const liveEquity = bankroll + liveTotalPnl;
  const rivalPnl =
    rivalEntryPrice !== null && price !== null
      ? positionPnl(
          { side: rivalSide, entryPrice: rivalEntryPrice, stake: RIVAL_STAKE, leverage: RIVAL_LEVERAGE, openedAt: 0 },
          price,
        )
      : 0;
  const displayRivalPnl = phase === "result" ? rivalFinalPnl ?? 0 : rivalPnl;
  const displayYourPnl = phase === "result" && outcome ? outcome.profit : liveTotalPnl;
  const sibylFinalEquity = STARTING_CASH + displayRivalPnl;
  const winner: Winner | null =
    phase === "result" && outcome
      ? Math.abs(outcome.finalValue - sibylFinalEquity) < 0.005
        ? "tie"
        : outcome.finalValue > sibylFinalEquity
          ? "you"
          : "sibyl"
      : null;

  const leadDelta = displayYourPnl - displayRivalPnl;
  maxLeadRef.current = Math.max(maxLeadRef.current, Math.abs(leadDelta));
  const leadSide: "you" | "sibyl" | "tie" = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "sibyl" : "tie";
  const sibylMood: "happy" | "sad" | "neutral" = leadSide === "sibyl" ? "happy" : leadSide === "you" ? "sad" : "neutral";

  const headlinePrice = outcome?.finalPrice ?? displayPrice;

  // Lead-change pulse + grounded Sibyl commentary, fired once per flip.
  useEffect(() => {
    const prev = prevLeadSideRef.current;
    prevLeadSideRef.current = leadSide;
    if (prev === leadSide || (leadSide !== "you" && leadSide !== "sibyl")) return;
    setLeadPulse({ side: leadSide, key: Date.now() });
    if (roundStart !== null && phase !== "result") {
      sayLine(leadSide === "you" ? LEAD_LOST_LINES : LEAD_TAKEN_LINES);
    }
  }, [leadSide, roundStart, phase, sayLine]);

  useEffect(() => {
    if (roundStart === null || phase === "result") {
      firedUrgentRef.current = false;
      return;
    }
    if (secondsLeft <= 10 && !firedUrgentRef.current) {
      firedUrgentRef.current = true;
      sayLine(URGENT_LINES);
    }
  }, [secondsLeft, roundStart, phase, sayLine]);

  useEffect(() => {
    if (phase !== "result" || winner === null) return;
    sayLine(winner === "sibyl" ? RESULT_WIN_LINES : winner === "you" ? RESULT_LOSS_LINES : RESULT_TIE_LINES);
    // Only once per settle — `winner` is stable for the rest of this phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "result" && winner]);

  const tradeMarkers: TradeMarker[] = trades.map((trade) => ({
    t: trade.t,
    p: trade.price,
    side: trade.side,
    action: trade.action,
    owner: trade.owner,
    pnl: trade.pnl,
  }));
  const openEntry = position ? { t: position.openedAt, p: position.entryPrice, side: position.side } : null;
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
    <main className="arena-shell mx-auto max-w-4xl px-4 py-10" data-market={market}>
      <PulseMovementAlert total={liveEquity} />
      <Link
        href="/duel"
        className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
      >
        ← Menu
      </Link>

      <PulseMarketTitle market={market}>
        {isPractice ? "Practice" : "Arena"} · Pulse
      </PulseMarketTitle>

      {/* Scoreboard: you, the clock, the AI rival */}
      <section className="arena-panel mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <div
              key={leadPulse?.side === "you" ? leadPulse.key : "you-avatar"}
              className={`duel-avatar h-6 w-6 text-[10px] sm:h-8 sm:w-8 sm:text-xs ${leadPulse?.side === "you" ? "is-lead" : ""}`}
              style={{ backgroundImage: YOU_GRADIENT }}
              aria-hidden="true"
            >
              Y
            </div>
            <ArenaScore
              name="You"
              equity={outcome ? outcome.finalValue : liveEquity}
              pnl={displayYourPnl}
              align="left"
            />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[var(--muted-dim)]">VS</span>
            <CountdownRing seconds={secondsLeft} total={ROUND_SECONDS} urgent={secondsLeft <= 10 && roundStart !== null} />
            <span className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
              {roundStart === null ? "Ready" : "Time left"}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
            <ArenaScore name="Sibyl · AI" equity={sibylFinalEquity} pnl={displayRivalPnl} align="right" />
            <div
              key={leadPulse?.side === "sibyl" ? leadPulse.key : "sibyl-avatar"}
              className={`duel-avatar h-6 w-6 sm:h-8 sm:w-8 ${leadPulse?.side === "sibyl" ? "is-lead" : ""}`}
              style={{ backgroundImage: RIVAL_GRADIENT }}
              aria-hidden="true"
            >
              <SibylFace mood={sibylMood} />
            </div>
          </div>
        </div>
        <LeadBar leadDelta={leadDelta} maxLead={maxLeadRef.current} rivalName="Sibyl" />
        {sibylLine && (
          <p key={sibylLineKey} className="sibyl-bubble mt-1.5 text-center text-[11px] text-[var(--muted)]">
            <span className="opacity-60">Sibyl:</span> {sibylLine}
          </p>
        )}
      </section>

      {/* Market price + feed status, centered */}
      <section className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--market-accent-strong)]">
            {outcome ? `Final ${marketLabel} / USD` : `${marketLabel} / USD`}
          </p>
          {!outcome && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "live"
                    ? "animate-pulse bg-[var(--brand)]"
                    : "bg-[var(--muted-dim)]"
                }`}
              />
              {status === "live" ? "live" : status}
            </span>
          )}
          {roundStart !== null && phase !== "result" && (
            <span className="text-xs uppercase tracking-wider text-[var(--brand)]">
              · round live
            </span>
          )}
        </div>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-[var(--text)]">
          <FlashingPrice price={headlinePrice} />
        </p>
      </section>

      <section className="mt-4">
        <PriceChart
          points={frozenPoints ?? points}
          trades={tradeMarkers}
          roundStart={roundStart}
          frozen={frozenPoints !== null}
          openEntry={openEntry}
          now={now}
        />
        <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--muted-dim)]">
          <span>Entries ○ · exits □ · reversals ◇ · dashed = Sibyl</span>
          <SoundToggle muted={muted} onToggle={toggleMuted} />
        </div>
      </section>

      <TradingDock
        marketLabel={marketLabel}
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
        isActing={isActing}
        pressedAction={pressedAction}
        onEnter={enterPosition}
        onClose={closePosition}
        onReverse={reversePosition}
        onRetry={() => void settle()}
        settleError={settleError}
        outcome={outcome}
        winner={winner}
        sibylFinalEquity={sibylFinalEquity}
        trades={trades}
        onPlayAgain={playAgain}
      />
    </main>
  );
}

type DockProps = {
  marketLabel: string;
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
  isActing: boolean;
  pressedAction: Side | "close" | null;
  onEnter: (side: Side) => void;
  onClose: () => void;
  onReverse: () => void;
  onRetry: () => void;
  settleError: boolean;
  outcome: Outcome | null;
  winner: Winner | null;
  sibylFinalEquity: number;
  trades: Trade[];
  onPlayAgain: () => void;
};

function TradingDock(props: DockProps) {
  const {
    marketLabel, phase, stake, setStake, leverage, setLeverage, position, closedPosition,
    livePrice, livePositionPnl, availableCash, isBusted, canEnter, canManage, isActing,
    pressedAction, onEnter, onClose, onReverse, onRetry,
    settleError, outcome, winner, sibylFinalEquity,
    trades, onPlayAgain,
  } = props;
  const [pressedSide, setPressedSide] = useState<Side | null>(null);
  const stakeDetailsRef = useRef<HTMLDetailsElement>(null);
  const leverageDetailsRef = useRef<HTMLDetailsElement>(null);

  const press = (side: Side) => {
    setPressedSide(side);
    onEnter(side);
    window.setTimeout(() => {
      setPressedSide(null);
    }, 180);
  };

  const closeDetails = (ref: React.RefObject<HTMLDetailsElement | null>) => {
    if (ref.current) ref.current.open = false;
  };

  return (
    <section
      className={
        phase === "setup" || phase === "open"
          ? "arena-dock dock-bar mt-4"
          : "arena-dock mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
      }
    >
      {phase === "setup" && (
        <>
          {closedPosition && (
            <p className="dock-last-note">
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
          <div className="dock-row">
            <details className="dock-select" ref={stakeDetailsRef}>
              <summary>
                <span className="dock-select-label">Amount</span>
                <span className="dock-select-value">{usd(Math.min(stake, availableCash))}</span>
                <span className="dock-select-chevron">▾</span>
              </summary>
              <div className="dock-select-menu">
                {FIXED_STAKE_OPTIONS.map((option) => {
                  const affordable = option <= availableCash;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={!affordable}
                      className={stake === option ? "is-selected" : ""}
                      onClick={() => {
                        setStake(option);
                        closeDetails(stakeDetailsRef);
                      }}
                    >
                      {usd(option)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={availableCash <= 0}
                  className={stake === availableCash ? "is-selected" : ""}
                  onClick={() => {
                    setStake(availableCash);
                    closeDetails(stakeDetailsRef);
                  }}
                >
                  Max
                </button>
              </div>
            </details>
            <details className="dock-select" ref={leverageDetailsRef}>
              <summary>
                <span className="dock-select-label">Leverage</span>
                <span className="dock-select-value">{leverage}×</span>
                <span className="dock-select-chevron">▾</span>
              </summary>
              <div className="dock-select-menu">
                {LEVERAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={leverage === option ? "is-selected" : ""}
                    onClick={() => {
                      setLeverage(option);
                      closeDetails(leverageDetailsRef);
                    }}
                  >
                    {option}×
                  </button>
                ))}
              </div>
            </details>
            <span className="dock-gear" role="img" aria-label="Setup">
              ⚙
            </span>
          </div>

          <div className="dock-row">
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
                className={`dock-action is-${side} ${
                  pressedSide === side ? "scale-[0.98] opacity-80" : ""
                }`}
              >
                {side === "long" ? "↗ Long" : "↘ Short"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">
            {isBusted
              ? "You're out of funds for this session."
              : canEnter
                ? "Press a side to enter at the live market price."
                : "Waiting for a live market connection…"}
          </p>
          {isBusted && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={onPlayAgain}
                className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
              >
                Reset & play again
              </button>
            </div>
          )}
        </>
      )}

      {phase === "open" && position && (
        <>
          <div className="dock-row">
            <span
              className="dock-chip"
              style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}
            >
              {position.side.toUpperCase()}
            </span>
            <span
              className="dock-live-pnl dock-pnl-hero"
              style={{ color: pnlColor(livePositionPnl) }}
            >
              {signedUsd(livePositionPnl)}
            </span>
            <span className="dock-meta">
              <span>
                {usd(position.entryPrice)} → {livePrice !== null ? usd(livePrice) : "—"}
              </span>
              <span>
                {usd(position.stake)} · {position.leverage}×
              </span>
            </span>
          </div>
          <div className="dock-row">
            <button
              type="button"
              disabled={!canManage || isActing}
              onClick={onClose}
              className={`dock-action is-${position.side} ${
                pressedAction === "close" ? "scale-[0.98]" : ""
              }`}
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canManage || isActing}
              onClick={onReverse}
              className="dock-action-secondary"
            >
              Reverse
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">
            Your next action executes immediately at the live market price.
          </p>
        </>
      )}

      {phase === "settling" && (
        <div className="flex items-center justify-between gap-4">
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

      {phase === "result" && outcome && winner && (
        <ArenaResultCard
          marketLabel={marketLabel}
          finalPrice={outcome.finalPrice}
          winner={winner === "sibyl" ? "rival" : winner}
          rivalName="Sibyl"
          yourEquity={outcome.finalValue}
          yourPnl={outcome.profit}
          rivalEquity={sibylFinalEquity}
          rivalPnl={sibylFinalEquity - STARTING_CASH}
          rivalAvatar={<SibylFace mood={winner === "sibyl" ? "happy" : winner === "you" ? "sad" : "neutral"} />}
          trades={trades.filter((t) => t.owner === "you")}
          playAgain={
            <button
              type="button"
              onClick={onPlayAgain}
              className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
            >
              Play Again
            </button>
          }
        />
      )}
    </section>
  );
}
