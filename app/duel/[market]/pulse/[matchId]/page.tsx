"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "@/app/PriceChart";
import PulseMovementAlert from "@/app/PulseMovementAlert";
import PulseMarketTitle from "@/app/PulseMarketTitle";
import PulseStakeStepper from "@/app/PulseStakeStepper";
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
} from "@/app/PulseArenaParts";
import { getPlayerId } from "@/app/lib/playerId";
import { clearActiveMatch, setActiveMatch } from "@/app/lib/activeMatch";
import { usePriceFeed } from "@/app/usePriceFeed";
import { type MatchView } from "@/lib/match";
import {
  clampPulseStake,
  pulseAvailableCash,
  pulseIsLiquidated,
  pulseIsOut,
  pulseLiquidationPrice,
  pulseMaxStake,
  pulsePositionPnl,
  pulsePositionsPnl,
  PULSE_LEVERAGE_OPTIONS,
  PULSE_STARTING_CASH,
  type PulsePosition,
  type PulseSide,
} from "@/lib/pulse";
import { productForMarket } from "@/lib/spotPrice";

// Every opponent links here for now — real players and house bots have no
// public profile page yet (only the mock traders in app/lib/mockProfiles.ts do).
const OPPONENT_PROFILE_HREF = "/profile/zane_lfg";
const POLL_MS = 1000;
const TICK_MS = 200;
const SKEW_RESYNC_MS = 1000;
type Owner = "you" | "room";
type LocalTrade = {
  t: number; p: number; side: PulseSide; action: "entry" | "exit" | "reverse"; owner: Owner; pnl?: number;
  /** On exit/reverse: the position this closed (the result card's trade review). */
  closed?: { side: PulseSide; entry: number; exit: number };
};
type LastClosed = { side: PulseSide; exitPrice: number; pnl: number };
type Gone = "ended" | "forbidden" | null;

const usd = (n: number) => n.toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;
const pnlColor = (n: number) => n >= 0 ? "var(--positive)" : "var(--negative)";
const sideColor = (side: PulseSide) => side === "long" ? "var(--chart-up)" : "var(--chart-down)";
const opposite = (side: PulseSide): PulseSide => side === "long" ? "short" : "long";

/** The fill a close realized at, recovered from the server's P&L for it. */
function exitPriceFor(position: PulsePosition, pnl: number) {
  if (pnl <= -position.stake) return pulseLiquidationPrice(position);
  const move = (pnl / (position.stake * position.leverage)) * position.entryPrice;
  return position.side === "long" ? position.entryPrice + move : position.entryPrice - move;
}

export default function Page({ params }: { params: Promise<{ market: string; matchId: string }> }) {
  const { market, matchId } = use(params);
  const router = useRouter();
  const product = productForMarket(market) ?? "BTC-USD";
  const { price, points, status, now } = usePriceFeed(product);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [gone, setGone] = useState<Gone>(null);
  const [stake, setStake] = useState(0);
  const [leverage, setLeverage] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [trades, setTrades] = useState<LocalTrade[]>([]);
  const [lastClosed, setLastClosed] = useState<LastClosed | null>(null);
  const [frozenPoints, setFrozenPoints] = useState<typeof points | null>(null);
  const [inviteJoin, setInviteJoin] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [line, setLine] = useState<{ text: string; key: number } | null>(null);
  const { muted, toggleMuted, playFeedback } = usePulseFeedback();
  // Positions this player closed themselves; any other disappearance mid-round
  // is a server-side liquidation.
  const closingRef = useRef(new Set<string>());
  // Last positions seen while the round was live, per side — diffed for
  // liquidations/opponent moves, and closed at the final price on settle.
  const prevPositionsRef = useRef<PulsePosition[]>([]);
  const prevOpponentRef = useRef<PulsePosition[]>([]);
  const settledMarkedRef = useRef(false);
  // Largest lead seen this round scales the lead bar; a lead flip pops the
  // leader's avatar once — same as the practice arena.
  const maxLeadRef = useRef(1);
  const prevLeadSideRef = useRef<"you" | "opponent" | "tie">("tie");
  const firedUrgentRef = useRef(false);
  const [leadPulse, setLeadPulse] = useState<{ side: "you" | "opponent"; key: number } | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const skewRef = useRef<number | null>(null);

  const say = useCallback((text: string) => setLine((current) => ({ text, key: (current?.key ?? 0) + 1 })), []);
  const addTrades = (next: LocalTrade[]) => {
    if (next.length > 0) setTrades((current) => [...current, ...next]);
  };

  useEffect(() => {
    setPlayerId(getPlayerId());
    setInviteJoin(new URLSearchParams(window.location.search).get("invite") === "1");
  }, []);
  const applyView = useCallback((next: MatchView) => {
    // Only re-sync on real drift: per-poll network jitter would otherwise shift
    // every server→local timestamp by a few ms each second, and `roundStart`
    // keys PriceChart's SVG — so the chart would remount (and replay its
    // entrance) on every poll.
    const skew = next.serverNow - Date.now();
    if (skewRef.current === null || Math.abs(skew - skewRef.current) > SKEW_RESYNC_MS) skewRef.current = skew;
    setView(next);
  }, []);

  // Once the round is actually underway, remember it so a global bar can
  // offer a way back in from anywhere else in the app - leaving this page
  // does not call `leave`, so the match keeps running server-side either way.
  useEffect(() => {
    if (view?.status === "predict" || view?.status === "countdown") {
      setActiveMatch({ matchId, market, mode: "pulse" });
    } else if (view?.status === "settled") {
      clearActiveMatch(matchId);
    }
  }, [view?.status, matchId, market]);

  useEffect(() => {
    if (gone) clearActiveMatch(matchId);
  }, [gone, matchId]);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/match/${encodeURIComponent(matchId)}?playerId=${encodeURIComponent(playerId)}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) return setGone("ended");
        if (res.status === 403) {
          if (!inviteJoin) return setGone("forbidden");
          const joinRes = await fetch(`/api/match/${encodeURIComponent(matchId)}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId }),
          });
          if (cancelled) return;
          if (joinRes.status === 404) return setGone("ended");
          if (joinRes.status === 409) return setGone("forbidden");
          if (!joinRes.ok) throw new Error("join failed");
        }
        if (res.ok) {
          const next = (await res.json()) as MatchView;
          if (next.mode !== "pulse") return setGone("ended");
          applyView(next);
          if (next.status === "settled") {
            window.dispatchEvent(new Event("balance-updated"));
            return;
          }
        }
      } catch {
        // Keep polling through transient API failures.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [matchId, playerId, inviteJoin, applyView]);

  const phase = view?.status;
  const toLocal = useCallback((serverMs: number | null) => serverMs === null ? null : serverMs - (skewRef.current ?? 0), []);
  const deadline = phase === "predict" ? toLocal(view?.lockDeadlineAt ?? null) : phase === "countdown" ? toLocal(view?.deadlineAt ?? null) : null;
  useEffect(() => {
    if (deadline === null) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [deadline]);
  useEffect(() => {
    if (!view || view.status !== "settled" || view.finalPrice === null) return;
    setFrozenPoints((prev) => prev ?? [...pointsRef.current, { t: toLocal(view.deadlineAt) ?? Date.now(), p: view.finalPrice! }]);
  }, [view, toLocal]);

  const positions = view?.pulseYourPositions ?? [];
  const opponentPositions = view?.pulseOpponentPositions ?? [];
  const realizedPnl = view?.pulseYourRealizedPnl ?? 0;
  const opponentRealizedPnl = view?.pulseOpponentRealizedPnl ?? 0;
  const livePnl = price === null ? 0 : pulsePositionsPnl(positions, price);
  const opponentLivePnl = price === null ? 0 : pulsePositionsPnl(opponentPositions, price);
  const yourProfit = view?.pulseYourProfit ?? realizedPnl + livePnl;
  const opponentProfit = view?.pulseOpponentProfit ?? opponentRealizedPnl + opponentLivePnl;
  const finalPrice = view?.finalPrice ?? price;
  const leadDelta = yourProfit - opponentProfit;
  maxLeadRef.current = Math.max(maxLeadRef.current, Math.abs(leadDelta));
  const leadSide: "you" | "opponent" | "tie" = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "opponent" : "tie";
  const canTrade = phase === "countdown" && price !== null && !busy;
  const availableCash = pulseAvailableCash(positions, realizedPnl);
  const isOut = phase === "countdown" && pulseIsOut(positions, realizedPnl);
  const canEnter = canTrade && positions.length === 0 && stake > 0 && availableCash > 0;
  const current = positions.at(-1) ?? null;

  // Lead-change pulse + a grounded line, fired once per flip.
  useEffect(() => {
    const prev = prevLeadSideRef.current;
    prevLeadSideRef.current = leadSide;
    if (prev === leadSide || leadSide === "tie") return;
    setLeadPulse({ side: leadSide, key: Date.now() });
    if (phase === "countdown") say(leadSide === "you" ? "You took the lead." : "Opponent took the lead.");
  }, [leadSide, phase, say]);

  useEffect(() => {
    if (phase === "countdown") say("Round live — trade the move.");
    if (phase === "settled" && view?.winner) {
      say(view.winner === "tie" ? "Dead even." : view.winner === "you" ? "You took the round." : `${view.opponentName ?? "Opponent"} took the round.`);
    }
    // Once per phase change; `winner` is set together with `settled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "countdown" || secondsLeft === null || secondsLeft > 10 || firedUrgentRef.current) return;
    firedUrgentRef.current = true;
    say("Final 10 seconds.");
  }, [phase, secondsLeft, say]);

  // Between positions the stake stays as last set (like practice); only clamp
  // it once nothing is reserving cash.
  useEffect(() => {
    if (positions.length === 0) setStake((value) => Math.min(value, pulseMaxStake(availableCash)));
  }, [availableCash, positions.length]);

  // Your positions that vanish without a local close were liquidated.
  useEffect(() => {
    if (phase !== "countdown") return;
    const prev = prevPositionsRef.current;
    prevPositionsRef.current = positions;
    const liquidated = prev.filter((item) => !closingRef.current.has(item.id) && !positions.some((next) => next.id === item.id));
    if (liquidated.length === 0) return;
    addTrades(liquidated.map((item) => ({
      t: Date.now(), p: pulseLiquidationPrice(item), side: item.side, action: "exit", owner: "you", pnl: -item.stake,
      closed: { side: item.side, entry: item.entryPrice, exit: pulseLiquidationPrice(item) },
    })));
    const lost = liquidated.reduce((total, item) => total + item.stake, 0);
    const last = liquidated[liquidated.length - 1];
    setLastClosed({ side: last.side, exitPrice: pulseLiquidationPrice(last), pnl: -last.stake });
    setNotice(liquidated.length === 1
      ? `Your ${liquidated[0].side} was liquidated: −${usd(lost)}`
      : `${liquidated.length} positions were liquidated: −${usd(lost)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, phase]);

  // The opponent's entries/closes, as dashed markers plus a one-line call-out.
  useEffect(() => {
    if (phase !== "countdown" || price === null) return;
    const prev = prevOpponentRef.current;
    prevOpponentRef.current = opponentPositions;
    const opened = opponentPositions.filter((item) => !prev.some((old) => old.id === item.id));
    const closed = prev.filter((item) => !opponentPositions.some((next) => next.id === item.id));
    if (opened.length === 0 && closed.length === 0) return;
    addTrades([
      ...closed.map((item) => {
        const pnl = pulsePositionPnl(item, price);
        return { t: Date.now(), p: price, side: item.side, action: "exit" as const, owner: "room" as const, pnl };
      }),
      ...opened.map((item) => ({
        t: (item.openedAt !== undefined ? toLocal(item.openedAt) : null) ?? Date.now(),
        p: item.entryPrice, side: item.side, action: "entry" as const, owner: "room" as const,
      })),
    ]);
    const newest = opened.at(-1);
    const shut = closed.at(-1);
    if (newest) say(`Opponent went ${newest.side} @ ${usd(newest.entryPrice)}.`);
    else if (shut) say(`Opponent closed a ${shut.side} (${signedUsd(pulsePositionPnl(shut, price))}).`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponentPositions, phase]);

  // At the bell the server closes everything at the final price; mark those
  // exits once, like practice's settle().
  useEffect(() => {
    if (phase !== "settled" || settledMarkedRef.current || view?.finalPrice == null) return;
    settledMarkedRef.current = true;
    const t = toLocal(view.deadlineAt) ?? Date.now();
    const close = (items: PulsePosition[], owner: Owner): LocalTrade[] => items.map((item) => ({
      t, p: view.finalPrice!, side: item.side, action: "exit", owner, pnl: pulsePositionPnl(item, view.finalPrice!),
      closed: { side: item.side, entry: item.entryPrice, exit: view.finalPrice! },
    }));
    addTrades([...close(prevPositionsRef.current, "you"), ...close(prevOpponentRef.current, "room")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, view?.finalPrice]);

  const roundStart = toLocal(view?.roundStartAt ?? null);
  const markerData = useMemo<TradeMarker[]>(() => trades.map((trade) => ({
    t: trade.t, p: trade.p, side: trade.side, action: trade.action, owner: trade.owner, pnl: trade.pnl,
  })), [trades]);

  const postAction = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/match/${encodeURIComponent(matchId)}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, ...body }),
    });
    if (!res.ok) throw new Error();
    const next = (await res.json()) as MatchView;
    applyView(next);
    return next;
  };
  const filledFrom = (before: PulsePosition[], next: MatchView) =>
    next.pulseYourPositions.find((item) => !before.some((prev) => prev.id === item.id));

  const run = async (task: () => Promise<void>) => {
    if (!playerId || busy || !canTrade) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch {
      setError("That action could not be synced. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const enter = (side: PulseSide) => run(async () => {
    const amount = clampPulseStake(stake, availableCash);
    if (amount <= 0) return setError("Set a stake first.");
    const next = await postAction({ action: "enter", side, stake: amount, leverage });
    // Mark an entry at the server's fill, not the local tick, so the marker
    // and the dock's entry price can't disagree.
    const filled = filledFrom(positions, next);
    if (filled) addTrades([{ t: Date.now(), p: filled.entryPrice, side, action: "entry", owner: "you" }]);
    setLastClosed(null);
    playFeedback("entry");
  });

  const closePosition = (position: PulsePosition) => run(async () => {
    closingRef.current.add(position.id);
    const next = await postAction({ action: "close", positionId: position.id });
    const pnl = next.pulseYourRealizedPnl - realizedPnl;
    const exitPrice = exitPriceFor(position, pnl);
    addTrades([{ t: Date.now(), p: exitPrice, side: position.side, action: "exit", owner: "you", pnl, closed: { side: position.side, entry: position.entryPrice, exit: exitPrice } }]);
    setLastClosed({ side: position.side, exitPrice, pnl });
    playFeedback("exit");
  });

  // Close, then open the other side with the same stake/leverage — one
  // reversal marker carrying the closed leg's P&L, as in practice.
  const reversePosition = (position: PulsePosition) => run(async () => {
    closingRef.current.add(position.id);
    const closed = await postAction({ action: "close", positionId: position.id });
    const pnl = closed.pulseYourRealizedPnl - realizedPnl;
    const exitPrice = exitPriceFor(position, pnl);
    const amount = clampPulseStake(position.stake, pulseAvailableCash(closed.pulseYourPositions, closed.pulseYourRealizedPnl));
    if (closed.status !== "countdown" || amount <= 0) {
      addTrades([{ t: Date.now(), p: exitPrice, side: position.side, action: "exit", owner: "you", pnl, closed: { side: position.side, entry: position.entryPrice, exit: exitPrice } }]);
      setLastClosed({ side: position.side, exitPrice, pnl });
      playFeedback("exit");
      return;
    }
    const side = opposite(position.side);
    const opened = await postAction({ action: "enter", side, stake: amount, leverage: position.leverage });
    const filled = filledFrom(closed.pulseYourPositions, opened);
    addTrades([{
      t: Date.now(), p: filled?.entryPrice ?? exitPrice, side, action: "reverse", owner: "you", pnl,
      closed: { side: position.side, entry: position.entryPrice, exit: exitPrice },
    }]);
    setLastClosed(null);
    playFeedback("reverse");
  });

  const leave = async () => {
    if (!playerId) return;
    setBusy(true);
    try {
      await fetch(`/api/match/${encodeURIComponent(matchId)}/leave`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }),
      });
    } finally {
      clearActiveMatch(matchId);
      router.push("/duel");
    }
  };

  if (gone) return <main className="mx-auto max-w-4xl px-4 py-10 text-center"><h1 className="text-lg font-medium text-[var(--text)]">{gone === "forbidden" ? "That match is full." : "Match ended"}</h1><p className="mt-2 text-sm text-[var(--muted)]">Start another Pulse round from the lobby.</p><Link href="/duel" className="mt-6 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)]">Back to lobby</Link></main>;

  const timerTotal = phase === "predict" ? 5 : view?.timerSeconds ?? 60;
  const ringSeconds = phase === "settled" ? 0 : secondsLeft ?? timerTotal;
  const marketLabel = market.toUpperCase();
  const yourEquity = PULSE_STARTING_CASH + yourProfit;
  const opponentEquity = PULSE_STARTING_CASH + opponentProfit;
  const openEntry = current?.openedAt !== undefined
    ? { t: toLocal(current.openedAt)!, p: current.entryPrice, side: current.side }
    : null;
  const dockPhase = phase === "settled"
    ? "result"
    : phase === "countdown" && secondsLeft === 0
      ? "settling"
      : phase === "countdown" && current
        ? "open"
        : "setup";
  const idleLine = !view || phase === "open" ? "Waiting for an opponent to join…" : phase === "predict" ? "Opponent's in. Round starts in a moment." : null;
  const bubble = line?.text ?? idleLine;
  // The server only names the opponent once the round has settled.
  const revealedName = phase === "settled" ? view?.opponentName ?? null : null;
  const rivalName = revealedName ?? "Opponent";
  const rivalInitial = revealedName?.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "O";

  return <main className="arena-shell mx-auto max-w-4xl px-4 py-10" data-market={market}>
    <PulseMovementAlert total={yourEquity} />
    <Link href="/duel" className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]">← Menu</Link>
    <PulseMarketTitle market={market}>Arena · Pulse</PulseMarketTitle>

    {/* Scoreboard: you, the clock, the opponent */}
    <section className="arena-panel mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <div key={leadPulse?.side === "you" ? leadPulse.key : "you-avatar"} className={`duel-avatar h-6 w-6 text-[10px] sm:h-8 sm:w-8 sm:text-xs ${leadPulse?.side === "you" ? "is-lead" : ""}`} style={{ backgroundImage: YOU_GRADIENT }} aria-hidden="true">Y</div>
          <ArenaScore name="You" equity={Math.max(0, yourEquity)} pnl={yourProfit} align="left" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[var(--muted-dim)]">VS</span>
          <CountdownRing seconds={ringSeconds} total={timerTotal} urgent={phase === "countdown" && (secondsLeft ?? 99) <= 10} />
          <span className="text-[9px] uppercase tracking-wider text-[var(--muted)]">{phase === "predict" ? "Starting in" : phase === "countdown" ? "Time left" : phase === "settled" ? "Final" : "Ready"}</span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <ArenaScore name={view?.opponentJoined ? rivalName : "Waiting"} equity={Math.max(0, opponentEquity)} pnl={opponentProfit} align="right" href={phase === "settled" ? OPPONENT_PROFILE_HREF : undefined} />
          <div key={leadPulse?.side === "opponent" ? leadPulse.key : "opponent-avatar"} className={`duel-avatar h-6 w-6 text-[10px] sm:h-8 sm:w-8 sm:text-xs ${leadPulse?.side === "opponent" ? "is-lead" : ""}`} style={{ backgroundImage: RIVAL_GRADIENT }} aria-hidden="true">{view?.opponentJoined ? rivalInitial : "?"}</div>
        </div>
      </div>
      <LeadBar leadDelta={leadDelta} maxLead={maxLeadRef.current} rivalName={rivalName} />
      {bubble && <p key={line?.key ?? "idle"} className="sibyl-bubble mt-1.5 text-center text-[11px] text-[var(--muted)]">{bubble}</p>}
    </section>

    {/* Market price + feed status, centered */}
    <section className="mt-6 text-center">
      <div className="flex items-center justify-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--market-accent-strong)]">{view?.finalPrice != null ? `Final ${marketLabel} / USD` : `${marketLabel} / USD`}</p>
        {view?.finalPrice == null && <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-[var(--brand)]" : "bg-[var(--muted-dim)]"}`} />{status === "live" ? "live" : status}</span>}
        {phase === "countdown" && <span className="text-xs uppercase tracking-wider text-[var(--brand)]">· round live</span>}
      </div>
      <p className="mt-1 text-4xl font-semibold tabular-nums text-[var(--text)]"><FlashingPrice price={finalPrice} /></p>
    </section>

    <section className="mt-4">
      <PriceChart points={frozenPoints ?? points} trades={markerData} roundStart={roundStart} frozen={frozenPoints !== null} openEntry={openEntry} now={now} />
      <div className="mt-2 flex items-center justify-between px-1 text-xs text-[var(--muted-dim)]">
        <span>Entries ○ · exits □ · reversals ◇ · dashed = Opponent</span>
        <SoundToggle muted={muted} onToggle={toggleMuted} />
      </div>
    </section>

    <RoomDock
      dockPhase={dockPhase}
      marketLabel={marketLabel}
      phase={phase}
      rivalName={rivalName}
      secondsLeft={secondsLeft}
      hasPrice={price !== null}
      stake={stake}
      setStake={setStake}
      leverage={leverage}
      setLeverage={setLeverage}
      availableCash={availableCash}
      isOut={isOut}
      canEnter={canEnter}
      canManage={canTrade}
      position={current}
      extraOpen={Math.max(0, positions.length - 1)}
      totalOpenPnl={livePnl}
      livePrice={price}
      lastClosed={lastClosed}
      onEnter={(side) => void enter(side)}
      onClose={() => current && void closePosition(current)}
      onReverse={() => current && void reversePosition(current)}
      result={view && phase === "settled" ? {
        finalPrice: view.finalPrice,
        winner: view.winner === "opponent" ? "rival" : view.winner ?? "tie",
        yourEquity: Math.max(0, yourEquity),
        yourPnl: yourProfit,
        rivalEquity: Math.max(0, opponentEquity),
        rivalPnl: opponentProfit,
        trades: trades.filter((trade) => trade.owner === "you").map((trade) => ({ side: trade.side, action: trade.action, price: trade.p, pnl: trade.pnl, closed: trade.closed })),
      } : null}
      notice={notice}
      error={error}
    />
    {phase === "open" || phase === "predict" ? <button type="button" onClick={() => void leave()} className="mx-auto mt-4 block text-xs uppercase tracking-wider text-[var(--muted-dim)] hover:text-[var(--text)]">Leave match</button> : null}
  </main>;
}

type DockProps = {
  dockPhase: "setup" | "open" | "settling" | "result";
  marketLabel: string;
  phase: MatchView["status"] | undefined;
  rivalName: string;
  secondsLeft: number | null;
  hasPrice: boolean;
  stake: number;
  setStake: (value: number) => void;
  leverage: number;
  setLeverage: (value: number) => void;
  availableCash: number;
  isOut: boolean;
  canEnter: boolean;
  canManage: boolean;
  position: PulsePosition | null;
  extraOpen: number;
  totalOpenPnl: number;
  livePrice: number | null;
  lastClosed: LastClosed | null;
  onEnter: (side: PulseSide) => void;
  onClose: () => void;
  onReverse: () => void;
  result: Omit<React.ComponentProps<typeof ArenaResultCard>, "marketLabel" | "rivalName" | "playAgain"> | null;
  notice: string | null;
  error: string | null;
};

/** Practice's TradingDock, with the ±$25/All in stepper in place of the Amount dropdown. */
function RoomDock(props: DockProps) {
  const {
    dockPhase, marketLabel, phase, rivalName, secondsLeft, hasPrice, stake, setStake, leverage, setLeverage,
    availableCash, isOut, canEnter, canManage, position, extraOpen, totalOpenPnl, livePrice,
    lastClosed, onEnter, onClose, onReverse, result, notice, error,
  } = props;
  const [pressedSide, setPressedSide] = useState<PulseSide | null>(null);
  const leverageDetailsRef = useRef<HTMLDetailsElement>(null);
  const canEdit = (phase === "predict" || phase === "countdown") && !isOut;
  // Already worth −stake; the server closes it on its next look at the tape.
  const liquidated = position !== null && livePrice !== null && pulseIsLiquidated(position, livePrice);

  const press = (side: PulseSide) => {
    setPressedSide(side);
    onEnter(side);
    window.setTimeout(() => setPressedSide(null), 180);
  };

  const setupHint =
    !phase || phase === "open"
      ? "Waiting for an opponent to join…"
      : phase === "predict"
        ? `Round starts in ${secondsLeft ?? "—"}s — pick your stake.`
        : isOut
          ? "You were liquidated — you're out for the rest of this round."
          : !hasPrice
            ? "Waiting for a live market connection…"
            : stake <= 0
              ? "Set a stake to trade."
              : "Press a side to enter at the live market price.";

  return (
    <section
      className={
        dockPhase === "setup" || dockPhase === "open"
          ? "arena-dock dock-bar mt-4"
          : "arena-dock mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
      }
    >
      {dockPhase === "setup" && (
        <>
          {lastClosed && (
            <p className="dock-last-note">
              Last: <span style={{ color: sideColor(lastClosed.side) }}>{lastClosed.side}</span> closed @ {usd(lastClosed.exitPrice)} ·{" "}
              <span style={{ color: pnlColor(lastClosed.pnl) }}>{signedUsd(lastClosed.pnl)}</span>
            </p>
          )}
          <div className="dock-row dock-row-wrap">
            <div className="dock-stake">
              <PulseStakeStepper stake={stake} availableCash={availableCash} disabled={!canEdit} onChange={setStake} />
            </div>
            <details className="dock-select dock-select-compact" ref={leverageDetailsRef}>
              <summary>
                <span className="dock-select-label">Leverage</span>
                <span className="dock-select-value">{leverage}×</span>
                <span className="dock-select-chevron">▾</span>
              </summary>
              <div className="dock-select-menu">
                {PULSE_LEVERAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={leverage === option ? "is-selected" : ""}
                    onClick={() => {
                      setLeverage(option);
                      if (leverageDetailsRef.current) leverageDetailsRef.current.open = false;
                    }}
                  >
                    {option}×
                  </button>
                ))}
              </div>
            </details>
            <span className="dock-gear" role="img" aria-label="Setup">⚙</span>
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
                className={`dock-action is-${side} ${pressedSide === side ? "scale-[0.98] opacity-80" : ""}`}
              >
                {side === "long" ? "↗ Long" : "↘ Short"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">{setupHint}</p>
        </>
      )}

      {dockPhase === "open" && position && (
        <>
          {extraOpen > 0 && (
            <p className="dock-last-note">
              +{extraOpen} more open · total <span style={{ color: pnlColor(totalOpenPnl) }}>{signedUsd(totalOpenPnl)}</span>
            </p>
          )}
          <OpenPositionRow position={position} livePrice={livePrice} />
          <div className="dock-row">
            <button type="button" disabled={!canManage || liquidated} onClick={onClose} className={`dock-action is-${position.side}`}>
              Close
            </button>
            <button type="button" disabled={!canManage || liquidated} onClick={onReverse} className="dock-action-secondary">
              Reverse
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-[var(--muted)]">
            Your next action executes immediately at the live market price. Liquidates at {usd(pulseLiquidationPrice(position))}.
          </p>
        </>
      )}

      {dockPhase === "settling" && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--muted)]">Fetching final price…</p>
        </div>
      )}

      {dockPhase === "result" && result && (
        <ArenaResultCard
          {...result}
          marketLabel={marketLabel}
          rivalName={rivalName}
          rivalHref={OPPONENT_PROFILE_HREF}
          playAgain={
            <Link
              href="/duel"
              className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-center text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
            >
              Play Again
            </Link>
          }
        />
      )}

      {notice && <p className="pt-2 text-center text-xs font-medium text-[var(--negative)]">{notice}</p>}
      {error && <p className="pt-2 text-center text-xs text-[var(--negative)]">{error}</p>}
    </section>
  );
}

function OpenPositionRow({ position, livePrice }: { position: PulsePosition; livePrice: number | null }) {
  const pnl = livePrice === null ? 0 : pulsePositionPnl(position, livePrice);
  // The server closes it on its next look at the tape; until then it's already worth −stake.
  const liquidated = livePrice !== null && pulseIsLiquidated(position, livePrice);
  return (
    <div className="dock-row">
      <span className="dock-chip" style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}>
        {position.side.toUpperCase()}
      </span>
      <span className="dock-live-pnl dock-pnl-hero" style={{ color: pnlColor(pnl) }}>
        {liquidated ? "Liquidated " : ""}{signedUsd(pnl)}
      </span>
      <span className="dock-meta">
        <span>{usd(position.entryPrice)} → {livePrice !== null ? usd(livePrice) : "—"}</span>
        <span>{usd(position.stake)} · {position.leverage}×</span>
      </span>
    </div>
  );
}
