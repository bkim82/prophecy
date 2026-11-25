"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { roundTrades, usePulseFeedback } from "@/app/PulseArenaParts";
import MatchScreen, {
  FlameGlyph,
  matchSignedUsd,
  matchUsd,
  PM_REMATCH_CLASS,
  RematchIcon,
  useWinStreak,
  type MatchChartMarkerInput,
  type MatchResult,
} from "@/app/PulseMatch";
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
import { RematchButton, RematchCheck, useRematch } from "./Rematch";

const POLL_MS = 1000;
const TICK_MS = 200;
const SKEW_RESYNC_MS = 1000;
type Owner = "you" | "room";
type LocalTrade = {
  t: number; p: number; side: PulseSide; action: "entry" | "exit" | "reverse"; owner: Owner; pnl?: number;
  /** On entry/reverse: the opened position's leverage (the result card's "Long 100×"). */
  leverage?: number;
  /** On exit/reverse: the position this closed (the result card's trade review). */
  closed?: { side: PulseSide; entry: number; exit: number };
  /** The exit was a liquidation. */
  liquidated?: boolean;
};
type Gone = "ended" | "forbidden" | null;

const usd = (n: number) => n.toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const priceText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const prevLeadSideRef = useRef<"you" | "opponent" | "tie">("tie");
  const firedUrgentRef = useRef(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const skewRef = useRef<number | null>(null);
  const rematchJumpedRef = useRef(false);

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
  const leadSide: "you" | "opponent" | "tie" = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "opponent" : "tie";
  const canTrade = phase === "countdown" && price !== null && !busy;
  const availableCash = pulseAvailableCash(positions, realizedPnl);
  const isOut = phase === "countdown" && pulseIsOut(positions, realizedPnl);
  const canEnter = canTrade && positions.length === 0 && stake > 0 && availableCash > 0;
  const current = positions.at(-1) ?? null;

  // A grounded line, fired once per lead flip.
  useEffect(() => {
    const prev = prevLeadSideRef.current;
    prevLeadSideRef.current = leadSide;
    if (prev === leadSide || leadSide === "tie") return;
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
      closed: { side: item.side, entry: item.entryPrice, exit: pulseLiquidationPrice(item) }, liquidated: true,
    })));
    const lost = liquidated.reduce((total, item) => total + item.stake, 0);
    setNotice(liquidated.length === 1
      ? `Your ${liquidated[0].side} was liquidated: −${usd(lost)}`
      : `${liquidated.length} positions were liquidated: −${usd(lost)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, phase]);

  // The opponent's entries/closes, recorded as dashed markers but kept off
  // the chart (and unannounced) until settle so the round stays blind.
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
        p: item.entryPrice, side: item.side, action: "entry" as const, owner: "room" as const, leverage: item.leverage,
      })),
    ]);
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
  const revealRoom = phase === "settled";
  const markerData = useMemo<MatchChartMarkerInput[]>(() => trades
    .filter((trade) => revealRoom || trade.owner !== "room")
    .map((trade) => ({ t: trade.t, p: trade.p, side: trade.side, action: trade.action, owner: trade.owner === "room" ? "rival" : "you" })), [trades, revealRoom]);

  // A settled challenge round offers a rematch; both pressing Play again
  // opens the next round, and both rooms move into it.
  const goToRematch = useCallback((nextMatchId: string) => {
    if (rematchJumpedRef.current) return;
    rematchJumpedRef.current = true;
    router.push(`/duel/${market}/pulse/${nextMatchId}`);
  }, [router, market]);
  const rematch = useRematch(matchId, playerId, phase === "settled" && Boolean(view?.challenge), goToRematch);
  useEffect(() => {
    if (rematch.state !== "theirs") return;
    say(`${view?.opponentName ?? "Opponent"} wants a rematch.`);
    playFeedback("entry");
    // Once per ask that reaches you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rematch.state]);

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
    if (filled) addTrades([{ t: Date.now(), p: filled.entryPrice, side, action: "entry", owner: "you", leverage }]);
    playFeedback("entry");
  });

  const closePosition = (position: PulsePosition) => run(async () => {
    closingRef.current.add(position.id);
    const next = await postAction({ action: "close", positionId: position.id });
    const pnl = next.pulseYourRealizedPnl - realizedPnl;
    const exitPrice = exitPriceFor(position, pnl);
    addTrades([{ t: Date.now(), p: exitPrice, side: position.side, action: "exit", owner: "you", pnl, closed: { side: position.side, entry: position.entryPrice, exit: exitPrice } }]);
    playFeedback("exit");
  });

  // Close, then open the other side with the same stake at the chosen
  // leverage — one reversal marker carrying the closed leg's P&L, as in practice.
  const reversePosition = (position: PulsePosition, nextLeverage: number) => run(async () => {
    closingRef.current.add(position.id);
    const closed = await postAction({ action: "close", positionId: position.id });
    const pnl = closed.pulseYourRealizedPnl - realizedPnl;
    const exitPrice = exitPriceFor(position, pnl);
    const amount = clampPulseStake(position.stake, pulseAvailableCash(closed.pulseYourPositions, closed.pulseYourRealizedPnl));
    if (closed.status !== "countdown" || amount <= 0) {
      addTrades([{ t: Date.now(), p: exitPrice, side: position.side, action: "exit", owner: "you", pnl, closed: { side: position.side, entry: position.entryPrice, exit: exitPrice } }]);
      playFeedback("exit");
      return;
    }
    const side = opposite(position.side);
    const opened = await postAction({ action: "enter", side, stake: amount, leverage: nextLeverage });
    const filled = filledFrom(closed.pulseYourPositions, opened);
    addTrades([{
      t: Date.now(), p: filled?.entryPrice ?? exitPrice, side, action: "reverse", owner: "you", pnl, leverage: nextLeverage,
      closed: { side: position.side, entry: position.entryPrice, exit: exitPrice },
    }]);
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

  const winner = phase === "settled" ? view?.winner ?? null : null;
  const streak = useWinStreak("pulse-streak-match", winner ? { id: matchId, won: winner === "you" } : null);

  if (gone) return <main className="mx-auto max-w-4xl px-4 py-10 text-center"><h1 className="text-lg font-medium text-[var(--text)]">{gone === "forbidden" ? "That match is full." : "Match ended"}</h1><p className="mt-2 text-sm text-[var(--muted)]">Start another Pulse round from the lobby.</p><Link href="/duel" className="mt-6 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)]">Back to lobby</Link></main>;

  const timerTotal = phase === "predict" ? 5 : view?.timerSeconds ?? 60;
  const ringSeconds = phase === "settled" ? 0 : phase === "predict" || phase === "countdown" ? secondsLeft ?? timerTotal : timerTotal;
  const marketLabel = market.toUpperCase();
  const yourEquity = PULSE_STARTING_CASH + yourProfit;
  const opponentEquity = PULSE_STARTING_CASH + opponentProfit;
  const idleLine = !view || phase === "open" ? "Waiting for an opponent to join…" : phase === "predict" ? "Opponent's in. Round starts in a moment." : null;
  const bubbleText = line?.text ?? idleLine;
  // The server only names the opponent once the round has settled.
  const revealedName = phase === "settled" ? view?.opponentName ?? null : null;
  const rivalName = revealedName ?? "Opponent";
  const rivalInitial = revealedName?.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || (view?.opponentJoined ? "O" : "?");
  const controlsState = !view || phase === "open" || phase === "predict"
    ? "waiting"
    : phase === "countdown" && secondsLeft === 0
      ? "settling"
      : phase === "countdown" && current
        ? "open"
        : "setup";
  const canEdit = (phase === "predict" || phase === "countdown") && !isOut;
  const hint = !view || phase === "open"
    ? "Waiting for an opponent to join…"
    : phase === "predict"
      ? `Round starts in ${secondsLeft ?? "—"}s — set your amount.`
      : isOut
        ? "You were liquidated — you're out for the rest of this round."
        : price === null
          ? "Waiting for a live market connection…"
          : stake <= 0
            ? "Set an amount to trade."
            : null;
  const currentOpenedAt = current
    ? (current.openedAt !== undefined ? toLocal(current.openedAt) : null)
      ?? [...trades].reverse().find((trade) => trade.owner === "you" && trade.action !== "exit")?.t
      ?? roundStart
      ?? Date.now()
    : 0;
  const currentPnl = current && price !== null ? pulsePositionPnl(current, price) : 0;

  const yourTrades = trades.filter((trade) => trade.owner === "you");
  const roomTrades = trades.filter((trade) => trade.owner === "room");
  const lastYours = [...yourTrades].reverse().find((trade) => trade.action !== "exit");
  const lastTheirs = [...roomTrades].reverse().find((trade) => trade.action !== "exit");
  const lastLeg = roundTrades(yourTrades.map((trade) => ({ ...trade, price: trade.p }))).at(-1) ?? null;
  const gap = Math.abs(leadDelta);
  const wager = view?.wager ?? 0;
  const lossStory = (() => {
    const liquidated = [...yourTrades].reverse().find((trade) => trade.liquidated);
    if (liquidated?.closed) {
      const lev = [...yourTrades].reverse().find((trade) => trade.t <= liquidated.t && trade.action !== "exit")?.leverage;
      return `Your ${lev ? `${lev}× ` : ""}${liquidated.closed.side} was liquidated at ${priceText(liquidated.closed.exit)}.`;
    }
    const firstTheirs = roomTrades.find((trade) => trade.action === "entry");
    if (!firstTheirs || view?.finalPrice == null) return null;
    return `${rivalName} ${firstTheirs.side === "short" ? "shorted" : "went long"} at ${priceText(firstTheirs.p)}; the bell rang at ${priceText(view.finalPrice)}.`;
  })();

  const result: MatchResult | null = view && phase === "settled" && winner ? {
    outcome: winner === "you" ? "win" : winner === "opponent" ? "loss" : "tie",
    hero: winner === "you"
      ? { value: wager * 2, format: (n: number) => `+${Math.round(n)}`, icon: <FlameGlyph size={40} /> }
      : { value: yourProfit, format: matchSignedUsd },
    caption: winner === "you"
      ? <>Embers won · beat {rivalName} by <span className="pm-num">{matchUsd(gap)}</span></>
      : winner === "opponent"
        ? <>your final P&amp;L · −{wager} Embers · {rivalName} won by <span className="pm-num">{matchUsd(gap)}</span></>
        : <>Dead even · {wager} Embers refunded</>,
    story: lossStory,
    you: { side: lastYours?.side ?? null, leverage: lastYours?.leverage ?? null, pnl: yourProfit },
    rival: { side: lastTheirs?.side ?? null, leverage: lastTheirs?.leverage ?? null, pnl: opponentProfit },
    lastTrade: lastLeg ? { entry: lastLeg.entry, exit: lastLeg.exit } : null,
    taunt: rematch.state === "theirs" ? `${rivalName} wants a rematch.` : null,
    rematch: view.challenge
      ? <RematchButton rematch={rematch} rivalName={rivalName} className={PM_REMATCH_CLASS} />
      : <Link href="/duel" className={PM_REMATCH_CLASS}><RematchIcon />Play again</Link>,
    shareText: winner === "you" ? `I beat ${rivalName} by ${matchUsd(gap)} in a ${view.timerSeconds}s ${marketLabel} Pulse duel on Prophecy.` : null,
    extra: (
      <>
        {view.challenge && <RematchCheck rematch={rematch} rivalName={rivalName} rivalInitial={rivalInitial} terms={{ market, timerSeconds: view.timerSeconds, wager: view.wager }} />}
        {rematch.error && <p className="pm-controls-notice" role="alert">{rematch.error}</p>}
      </>
    ),
  } : null;

  return (
    <MatchScreen
      roundKey={matchId}
      market={market}
      marketLabel={marketLabel}
      modeTag={view ? <>PULSE · <FlameGlyph size={10} /> {wager * 2} POT</> : "ARENA · PULSE"}
      feedLive={status === "live"}
      streak={streak}
      sound={{ muted, toggle: toggleMuted, play: playFeedback }}
      backHref="/duel"
      alertTotal={yourEquity}
      roundStarted={phase === "countdown" || phase === "settled"}
      you={{
        equity: yourEquity,
        pnl: yourProfit,
        position: current ? {
          side: current.side,
          entryPrice: current.entryPrice,
          leverage: current.leverage,
          openedAt: currentOpenedAt,
          pnl: currentPnl,
          liquidated: price !== null && pulseIsLiquidated(current, price),
        } : null,
      }}
      rival={{
        name: view?.opponentJoined || revealedName ? rivalName : "Waiting",
        kind: "player",
        initial: rivalInitial,
        equity: opponentEquity,
        pnl: opponentProfit,
        // Blind until settle: their side stays hidden mid-round.
        side: null,
      }}
      timer={{ seconds: ringSeconds, caption: phase === "predict" ? "to start" : "seconds left", live: phase === "countdown" }}
      bubble={bubbleText ? { text: bubbleText, key: line?.key ?? 0 } : null}
      chart={{ points: frozenPoints ?? points, now, frozen: frozenPoints !== null, price: finalPrice, markers: markerData }}
      controls={{
        state: controlsState,
        stake: { value: stake, available: availableCash, onChange: setStake },
        leverage,
        leverageOptions: PULSE_LEVERAGE_OPTIONS,
        onLeverage: setLeverage,
        canEdit,
        canEnter,
        onEnter: (side) => void enter(side),
        hint,
        canManage: canTrade,
        onClose: () => { if (current) void closePosition(current); },
        onFlip: (nextLeverage) => { if (current) void reversePosition(current, nextLeverage); },
        extraOpen: Math.max(0, positions.length - 1),
        notice,
        error,
        footer: phase === "open" || phase === "predict"
          ? <button type="button" onClick={() => void leave()} className="pm-leave">Leave match</button>
          : null,
      }}
      result={result}
    />
  );
}
