"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePriceFeed, type PricePoint } from "../../../usePriceFeed";
import { roundTrades, usePulseFeedback } from "../../../PulseArenaParts";
import MatchScreen, {
  compactUsd,
  liquidationPrice,
  MatchMenuOption,
  matchSignedUsd,
  matchUsd,
  RematchAction,
  useWinStreak,
  type MatchPosition,
  type MatchResult,
} from "../../../PulseMatch";
import { productForMarket } from "@/lib/spotPrice";

const ROUND_SECONDS = 60;
const STARTING_CASH = 100;
const DEFAULT_LEVERAGE = 100;
const LEVERAGE_OPTIONS = [100, 1000, 10000];
const FIXED_STAKE_OPTIONS = [10, 25, 50];
const RIVAL_STAKE = 48;
const RIVAL_LEVERAGE = 10;
// A single tick moving your position by this share of its stake (and at
// least $1) gets a line from Sibyl, at most once per BIG_TICK_GAP_MS.
const BIG_TICK_SHARE = 0.05;
const BIG_TICK_GAP_MS = 8000;

// Each line a short, grounded reaction to a real state change — never a
// claim about activity that didn't happen.
const ROUND_START_LINES = ["Let's see what you've got.", "Game on.", "Show me your edge."];
const ENTRY_LINES = ["Bold. Let's see if it holds.", "Interesting entry.", "I'd have waited."];
const LEAD_TAKEN_LINES = ["I'm reading the tape well right now.", "This one's mine for now.", "Running the numbers my way."];
const LEAD_LOST_LINES = ["Hm, recalibrating.", "Not bad — yet.", "You got the better entry there."];
const BIG_GAIN_LINES = ["Okay… that one stings.", "Lucky tick.", "Don't get comfortable."];
const BIG_LOSS_LINES = ["The tape doesn't love you.", "Ouch. For you.", "That's going to leave a mark."];
const LIQUIDATED_LINES = ["Liquidated. Leverage cuts both ways.", "And that's the margin call."];
const URGENT_LINES = ["Clock's ticking.", "Final stretch.", "Make it count."];
const RESULT_WIN_LINES = ["Analysis complete: I had the edge.", "That's the round. Rematch?"];
const RESULT_LOSS_LINES = ["GG. Run it again?", "Rematch? I'll be ready this time."];
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
  /** On entry/reverse: the leverage of the position it opened. */
  leverage?: number;
  pnl?: number;
  /** On exit/reverse: the position this closed (the result card's trade review). */
  closed?: { side: Side; entry: number; exit: number };
  /** The exit was a liquidation. */
  liquidated?: boolean;
};

type Outcome = {
  finalPrice: number;
  profit: number;
  finalValue: number;
};

type Winner = "you" | "sibyl" | "tie";

const priceText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Isolated margin, as in real matches (lib/pulse.ts): a position can lose its
// stake and no more, and is closed at the liquidation price when it does.
const positionPnl = (position: Position, price: number) => {
  const move =
    position.side === "long"
      ? price - position.entryPrice
      : position.entryPrice - price;
  return Math.max(-position.stake, position.stake * (move / position.entryPrice) * position.leverage);
};

export default function Page() {
  // `?market=eth` reuses this solo loop for any priced market; BTC otherwise.
  const [market, setMarket] = useState("btc");
  const product = productForMarket(market) ?? "BTC-USD";
  const marketLabel = market.toUpperCase();
  const { price, points, status, now, getLivePrice } = usePriceFeed(product);
  const [phase, setPhase] = useState<Phase>("setup");
  const [position, setPosition] = useState<Position | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stake, setStake] = useState(STARTING_CASH);
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [roundStart, setRoundStart] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [realizedPnl, setRealizedPnl] = useState(0);
  const [bankroll, setBankroll] = useState(STARTING_CASH);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [rivalFinalPnl, setRivalFinalPnl] = useState<number | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [rivalEntryPrice, setRivalEntryPrice] = useState<number | null>(null);
  const [rivalSide, setRivalSide] = useState<Side>("short");
  const [isPractice, setIsPractice] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sibylLine, setSibylLine] = useState(IDLE_LINE);
  const [sibylLineKey, setSibylLineKey] = useState(0);
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
  const prevLeadSideRef = useRef<"you" | "sibyl" | "tie">("tie");
  const firedUrgentRef = useRef(false);
  const bigTickRef = useRef<{ openedAt: number | null; pnl: number | null; at: number }>({ openedAt: null, pnl: null, at: 0 });

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
    if (roundStart !== null) return false;
    const start = Date.now();
    const side: Side = entryPrice % 2 > 1 ? "long" : "short";
    setRoundStart(start);
    setRivalEntryPrice(entryPrice);
    setRivalSide(side);
    addTrade({ t: start, side, action: "entry", price: entryPrice, amount: RIVAL_STAKE, owner: "sibyl", leverage: RIVAL_LEVERAGE });
    sayLine(ROUND_START_LINES);
    return true;
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
    if (!beginRound(execPrice)) sayLine(ENTRY_LINES);
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    setNotice(null);
    setPhase("open");
    addTrade({ t: nextPosition.openedAt, side, action: "entry", price: execPrice, amount: nextPosition.stake, owner: "you", leverage });
    playFeedback("entry");
  };

  const lockActions = () => {
    isActingRef.current = true;
    setIsActing(true);
    window.setTimeout(() => {
      isActingRef.current = false;
      setIsActing(false);
    }, 240);
  };

  const closePosition = () => {
    if (phase !== "open" || positionRef.current === null || isActingRef.current) return;
    const execPrice = getLivePrice();
    if (execPrice === null) return;

    const current = positionRef.current;
    const pnl = positionPnl(current, execPrice);
    realizedPnlRef.current += pnl;
    setRealizedPnl(realizedPnlRef.current);
    positionRef.current = null;
    setPosition(null);
    setPhase("setup");
    addTrade({
      t: Date.now(), side: current.side, action: "exit", price: execPrice, amount: current.stake, owner: "you", pnl,
      closed: { side: current.side, entry: current.entryPrice, exit: execPrice },
    });
    lockActions();
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
    addTrade({
      t: nextPosition.openedAt,
      side: nextSide,
      action: "reverse",
      price: execPrice,
      amount: nextPosition.stake,
      owner: "you",
      leverage: nextPosition.leverage,
      pnl: closedPnl,
      closed: { side: current.side, entry: current.entryPrice, exit: execPrice },
    });
    lockActions();
    playFeedback("reverse");
  };

  // A position that's lost its whole stake closes at the liquidation price,
  // like the server's liquidateIfDue in real matches.
  useEffect(() => {
    const current = positionRef.current;
    if (phase !== "open" || !current || price === null) return;
    if (positionPnl(current, price) > -current.stake) return;
    const exit = liquidationPrice(current.side, current.entryPrice, current.leverage);
    realizedPnlRef.current -= current.stake;
    setRealizedPnl(realizedPnlRef.current);
    positionRef.current = null;
    setPosition(null);
    setPhase("setup");
    addTrade({
      t: Date.now(), side: current.side, action: "exit", price: exit, amount: current.stake, owner: "you", pnl: -current.stake,
      closed: { side: current.side, entry: current.entryPrice, exit }, liquidated: true,
    });
    setNotice(`Your ${current.leverage}× ${current.side} was liquidated at ${priceText(exit)}: −${matchUsd(current.stake)}`);
    sayLine(LIQUIDATED_LINES);
    playFeedback("exit");
    // Once per price tick; the refs carry the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price, phase]);

  // A single big tick on your position gets a reaction (throttled).
  useEffect(() => {
    const current = positionRef.current;
    const ref = bigTickRef.current;
    if (phase !== "open" || !current || price === null) {
      ref.openedAt = null;
      ref.pnl = null;
      return;
    }
    const pnl = positionPnl(current, price);
    const prev = ref.openedAt === current.openedAt ? ref.pnl : null;
    ref.openedAt = current.openedAt;
    ref.pnl = pnl;
    if (prev === null) return;
    const delta = pnl - prev;
    const at = Date.now();
    if (Math.abs(delta) < Math.max(1, current.stake * BIG_TICK_SHARE) || at - ref.at < BIG_TICK_GAP_MS) return;
    ref.at = at;
    sayLine(delta > 0 ? BIG_GAIN_LINES : BIG_LOSS_LINES);
  }, [price, phase, sayLine]);

  const playAgain = () => {
    // Only busted players get a fresh $100 — otherwise the bankroll carries
    // over from the last round so losses actually stick.
    const nextBankroll = bankrollRef.current <= 0 ? STARTING_CASH : bankrollRef.current;
    bankrollRef.current = nextBankroll;
    setBankroll(nextBankroll);
    positionRef.current = null;
    realizedPnlRef.current = 0;
    setPosition(null);
    setRealizedPnl(0);
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
    setNotice(null);
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
  // The duel is the round's P&L — the same figure the scoreboard and lead
  // line show — so a bankroll carried over from earlier rounds can't decide it.
  const winner: Winner | null =
    phase === "result" && outcome
      ? Math.abs(outcome.profit - displayRivalPnl) < 0.005
        ? "tie"
        : outcome.profit > displayRivalPnl
          ? "you"
          : "sibyl"
      : null;

  const leadDelta = displayYourPnl - displayRivalPnl;
  const leadSide: "you" | "sibyl" | "tie" = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "sibyl" : "tie";

  // Grounded Sibyl commentary, fired once per lead flip.
  useEffect(() => {
    const prev = prevLeadSideRef.current;
    prevLeadSideRef.current = leadSide;
    if (prev === leadSide || (leadSide !== "you" && leadSide !== "sibyl")) return;
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

  const streak = useWinStreak(
    `pulse-streak-${isPractice ? "practice" : "solo"}`,
    winner && roundStart !== null ? { id: String(roundStart), won: winner === "you" } : null,
  );

  const availableCash = Math.max(0, bankroll + realizedPnl);
  const isBusted = phase === "setup" && availableCash <= 0;
  const hasLivePrice = price !== null;
  const canEnter = phase === "setup" && hasLivePrice && availableCash > 0;
  const canManage = phase === "open" && hasLivePrice && !isActing;

  useEffect(() => {
    if (stake > availableCash && availableCash > 0) {
      setStake(availableCash);
    }
  }, [availableCash, stake]);

  const yourTrades = trades.filter((trade) => trade.owner === "you");
  const lastOpened = [...yourTrades].reverse().find((trade) => trade.action !== "exit");
  const closedLegs = roundTrades(yourTrades);
  const lastLeg = closedLegs.at(-1) ?? null;
  const gap = Math.abs(displayYourPnl - displayRivalPnl);

  const matchPosition: MatchPosition | null = position
    ? {
        side: position.side,
        entryPrice: position.entryPrice,
        leverage: position.leverage,
        openedAt: position.openedAt,
        pnl: livePositionPnl,
        liquidated: livePositionPnl <= -position.stake,
      }
    : null;

  const lossStory = (() => {
    const liquidated = [...yourTrades].reverse().find((trade) => trade.liquidated);
    if (liquidated?.closed) {
      const lev = [...yourTrades].reverse().find((trade) => trade.t <= liquidated.t && trade.action !== "exit")?.leverage;
      return `Your ${lev ? `${lev}× ` : ""}${liquidated.closed.side} was liquidated at ${priceText(liquidated.closed.exit)}.`;
    }
    if (rivalEntryPrice === null || !outcome) return null;
    return `Sibyl ${rivalSide === "short" ? "shorted" : "went long on"} ${marketLabel} at ${priceText(rivalEntryPrice)} and held to ${priceText(outcome.finalPrice)}.`;
  })();

  const result: MatchResult | null =
    phase === "result" && outcome && winner
      ? {
          outcome: winner === "you" ? "win" : winner === "sibyl" ? "loss" : "tie",
          hero: { value: outcome.profit, format: matchSignedUsd },
          caption:
            winner === "you"
              ? <>{isPractice ? "practice payout" : "round P&L"} · beat Sibyl by <span className="pm-num">{matchUsd(gap)}</span></>
              : winner === "sibyl"
                ? <>your final P&amp;L · Sibyl won by <span className="pm-num">{matchUsd(gap)}</span></>
                : "Dead even at the bell",
          story: lossStory,
          you: { side: lastOpened?.side ?? null, leverage: lastOpened?.leverage ?? null, pnl: outcome.profit },
          rival: { side: rivalEntryPrice !== null ? rivalSide : null, leverage: rivalEntryPrice !== null ? RIVAL_LEVERAGE : null, pnl: displayRivalPnl },
          lastTrade: lastLeg ? { entry: lastLeg.entry, exit: lastLeg.exit } : null,
          taunt: sibylLine,
          rematch: <RematchAction onClick={playAgain} />,
          shareText: winner === "you" ? `I beat Sibyl by ${matchUsd(gap)} in a ${ROUND_SECONDS}s ${marketLabel} Pulse duel on Prophecy.` : null,
          playForRealHref: isPractice ? "/duel" : undefined,
        }
      : null;

  return (
    <MatchScreen
      roundKey={roundStart ?? "ready"}
      market={market}
      marketLabel={marketLabel}
      modeTag={`${isPractice ? "PRACTICE" : "ARENA"} · PULSE`}
      feedLive={status === "live"}
      streak={streak}
      sound={{ muted, toggle: toggleMuted, play: playFeedback }}
      backHref="/duel"
      alertTotal={liveEquity}
      roundStarted={roundStart !== null}
      you={{ equity: outcome ? outcome.finalValue : liveEquity, pnl: displayYourPnl, position: matchPosition }}
      rival={{
        name: "Sibyl",
        kind: "sibyl",
        initial: "S",
        equity: sibylFinalEquity,
        pnl: displayRivalPnl,
        side: rivalEntryPrice !== null ? rivalSide : null,
      }}
      timer={{ seconds: secondsLeft, total: ROUND_SECONDS, caption: "SEC", live: roundStart !== null && phase !== "result" }}
      bubble={{ speaker: "Sibyl", text: sibylLine, key: sibylLineKey }}
      chart={{
        points: frozenPoints ?? points,
        now,
        frozen: frozenPoints !== null,
        price: outcome?.finalPrice ?? price,
        markers: trades
          .filter((trade) => trade.owner === "you" || trade.action === "entry")
          .map((trade) => ({ t: trade.t, p: trade.price, side: trade.side, action: trade.action, owner: trade.owner === "you" ? "you" : "rival" })),
      }}
      controls={{
        state: phase === "open" ? "open" : phase === "settling" ? "settling" : "setup",
        amountLabel: compactUsd(Math.min(stake, availableCash)),
        amountMenu: (close) => (
          <>
            {FIXED_STAKE_OPTIONS.map((option) => (
              <MatchMenuOption
                key={option}
                selected={stake === option}
                disabled={option > availableCash}
                onClick={() => {
                  setStake(option);
                  close();
                }}
              >
                {compactUsd(option)}
              </MatchMenuOption>
            ))}
            <MatchMenuOption
              selected={stake === availableCash}
              disabled={availableCash <= 0}
              onClick={() => {
                setStake(availableCash);
                close();
              }}
            >
              Max <small>{matchUsd(availableCash)}</small>
            </MatchMenuOption>
          </>
        ),
        leverage,
        leverageOptions: LEVERAGE_OPTIONS,
        onLeverage: setLeverage,
        canEdit: phase === "setup" && !isBusted,
        canEnter,
        onEnter: enterPosition,
        hint: isBusted
          ? "You're out of funds for this session."
          : !hasLivePrice
            ? "Waiting for a live market connection…"
            : null,
        canManage,
        onClose: closePosition,
        onFlip: reversePosition,
        notice,
        footer: isBusted ? (
          <button type="button" className="pm-secondary" onClick={playAgain}>Reset &amp; play again</button>
        ) : phase === "settling" && settleError ? (
          <>
            <p className="pm-controls-notice" role="alert">Could not fetch the final price.</p>
            <button type="button" className="pm-secondary" onClick={() => void settle()}>Retry</button>
          </>
        ) : null,
      }}
      result={result}
    />
  );
}
