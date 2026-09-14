"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "@/app/PriceChart";
import { getPlayerId } from "@/app/lib/playerId";
import { usePriceFeed } from "@/app/usePriceFeed";
import { type MatchView } from "@/lib/match";
import {
  pulseAvailableCash,
  pulsePositionsPnl,
  PULSE_LEVERAGE_OPTIONS,
  PULSE_STARTING_CASH,
  type PulsePosition,
  type PulseSide,
} from "@/lib/pulse";
import { productForMarket } from "@/lib/spotPrice";

const POLL_MS = 1000;
const TICK_MS = 200;
const STAKE_OPTIONS = [10, 25, 50];
type Action = "enter" | "close";
type LocalTrade = { t: number; p: number; side: PulseSide; action: "entry" | "exit" };
type Gone = "ended" | "forbidden" | null;

const usd = (n: number) => n.toLocaleString("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;
const pnlColor = (n: number) => n >= 0 ? "var(--positive)" : "var(--negative)";
const sideColor = (side: PulseSide) => side === "long" ? "var(--chart-up)" : "var(--chart-down)";
const formatTime = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export default function Page({ params }: { params: Promise<{ market: string; matchId: string }> }) {
  const { market, matchId } = use(params);
  const router = useRouter();
  const product = productForMarket(market) ?? "BTC-USD";
  const { price, points, status, now } = usePriceFeed(product);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [gone, setGone] = useState<Gone>(null);
  const [stake, setStake] = useState(25);
  const [leverage, setLeverage] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [trades, setTrades] = useState<LocalTrade[]>([]);
  const [frozenPoints, setFrozenPoints] = useState<typeof points | null>(null);
  const [inviteJoin, setInviteJoin] = useState(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const skewRef = useRef(0);

  useEffect(() => {
    setPlayerId(getPlayerId());
    setInviteJoin(new URLSearchParams(window.location.search).get("invite") === "1");
  }, []);
  const applyView = useCallback((next: MatchView) => {
    skewRef.current = next.serverNow - Date.now();
    setView(next);
  }, []);

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
          if (next.status === "settled") return;
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
  const toLocal = useCallback((serverMs: number | null) => serverMs === null ? null : serverMs - skewRef.current, []);
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
  const canTrade = phase === "countdown" && price !== null && !busy;
  const availableCash = pulseAvailableCash(positions, realizedPnl);
  const roundStart = toLocal(view?.roundStartAt ?? null);
  const markerData = useMemo<TradeMarker[]>(() => trades.map((trade) => ({
    t: trade.t, p: trade.p, side: trade.side, action: trade.action,
  })), [trades]);

  const sendAction = async (action: Action, side?: PulseSide, positionId?: string) => {
    if (!playerId || busy || !canTrade) return;
    if (action === "enter" && stake > availableCash) {
      setError("Not enough balance for that stake.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/match/${encodeURIComponent(matchId)}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, action, side, positionId, stake, leverage }),
      });
      if (!res.ok) throw new Error();
      applyView((await res.json()) as MatchView);
      if (price !== null) {
        setTrades((current) => [...current, {
          t: Date.now(), p: price, side: side ?? positions.find((item) => item.id === positionId)?.side ?? "long",
          action: action === "enter" ? "entry" : "exit",
        }]);
      }
    } catch {
      setError("That action could not be synced. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!playerId) return;
    setBusy(true);
    try {
      await fetch(`/api/match/${encodeURIComponent(matchId)}/leave`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }),
      });
    } finally {
      router.push("/duel");
    }
  };

  if (gone) return <main className="mx-auto max-w-4xl px-4 py-10 text-center"><h1 className="text-lg font-medium text-[var(--text)]">{gone === "forbidden" ? "That match is full." : "Match ended"}</h1><p className="mt-2 text-sm text-[var(--muted)]">Start another Pulse round from the lobby.</p><Link href="/duel" className="mt-6 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)]">Back to lobby</Link></main>;

  return <main className="mx-auto max-w-4xl px-4 py-10">
    <Link href="/duel" className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]">← Menu</Link>
    <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">{market.toUpperCase()} Duel · Pulse {view ? `· ${view.timerSeconds}s` : ""}</h1>

    <section className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4"><Score name="You" equity={PULSE_STARTING_CASH + yourProfit} pnl={yourProfit} /><div className="flex min-w-20 flex-col items-center"><span className="text-xs uppercase tracking-wider text-[var(--muted)]">{phase === "predict" ? "Starting in" : "Time left"}</span><span className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">{phase === "predict" ? `${secondsLeft ?? "—"}s` : formatTime(secondsLeft ?? 0)}</span></div><Score name={view?.opponentJoined ? "Opponent" : "Waiting"} equity={PULSE_STARTING_CASH + opponentProfit} pnl={opponentProfit} /></section>
    <section className="mt-6 text-center"><div className="flex items-center justify-center gap-2"><p className="text-xs uppercase tracking-wider text-[var(--muted)]">{view?.finalPrice !== null && view?.finalPrice !== undefined ? `Final ${market.toUpperCase()} / USD` : `${market.toUpperCase()} / USD`}</p><span className="text-xs text-[var(--muted)]">● {status === "live" ? "live" : status}</span></div><p className="mt-1 text-5xl font-semibold tabular-nums text-[var(--text)]">{finalPrice === null ? "Loading…" : usd(finalPrice)}</p></section>
    <section className="mt-4"><PriceChart points={frozenPoints ?? points} trades={markerData} roundStart={roundStart} frozen={frozenPoints !== null} now={now} /><div className="mt-2 flex justify-between px-1 text-xs text-[var(--muted-dim)]"><span>Entries ◇ · exits □</span><span>{phase === "predict" ? "Round warming up" : "Add as many positions as you want"}</span></div></section>

    <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[var(--line)] pb-4"><div><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Trading dock</p><h2 className="mt-1 font-medium text-[var(--text)]">{phase === "predict" ? "Get ready" : phase === "countdown" ? "Trade the move" : phase === "settled" ? "Round complete" : "Waiting for opponent"}</h2></div><div className="text-center"><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Balance</p><p className="mt-1 text-xl font-semibold tabular-nums text-[var(--accent-strong)]">{usd(availableCash)}</p></div><div className="text-right text-xs uppercase tracking-wider text-[var(--muted)]">{positions.length} open position{positions.length === 1 ? "" : "s"}</div></div>

      {phase === "predict" && <div className="py-8 text-center"><p className="text-3xl font-semibold tabular-nums text-[var(--text)]">{secondsLeft ?? "—"}s</p><p className="mt-2 text-sm text-[var(--muted)]">The round starts automatically. You can trade once the countdown reaches zero.</p></div>}

      {phase === "countdown" && <div className="pt-4"><div className="mb-4 grid gap-2 sm:grid-cols-2">{positions.length === 0 ? <p className="rounded-md border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">No open positions yet. Add a long or short below.</p> : positions.map((position) => <PositionCard key={position.id} position={position} price={price} onClose={() => void sendAction("close", undefined, position.id)} disabled={!canTrade} />)}</div><div className="grid gap-4 sm:grid-cols-2"><div><div className="flex justify-between"><span className="text-xs uppercase tracking-wider text-[var(--muted)]">Stake per entry</span><span className="text-xs tabular-nums text-[var(--muted)]">{usd(Math.min(stake, availableCash))}</span></div><div className="mt-2 grid grid-cols-4 gap-2">{STAKE_OPTIONS.map((option) => <button key={option} type="button" disabled={option > availableCash || !canTrade} onClick={() => setStake(option)} className={`rounded-md border py-1.5 text-xs font-medium tabular-nums ${stake === option ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{usd(option)}</button>)}<button type="button" disabled={!canTrade} onClick={() => setStake(Math.max(1, availableCash))} className={`rounded-md border py-1.5 text-xs font-medium tabular-nums ${stake === availableCash ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]" : "border-[var(--line)] text-[var(--muted)]"}`}>All in</button></div></div><div><div className="flex justify-between"><span className="text-xs uppercase tracking-wider text-[var(--muted)]">Leverage</span><span className="text-xs tabular-nums text-[var(--muted)]">{leverage}×</span></div><div className="mt-2 grid grid-cols-3 gap-1.5">{PULSE_LEVERAGE_OPTIONS.map((option) => <button key={option} type="button" disabled={!canTrade} onClick={() => setLeverage(option)} className={`rounded-md border py-1.5 text-xs font-medium tabular-nums ${leverage === option ? "border-[var(--accent)] bg-[var(--selected-bg)] text-[var(--accent-strong)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{option}×</button>)}</div></div></div><div className="mt-4 grid grid-cols-2 gap-3"><button type="button" disabled={!canTrade} onClick={() => void sendAction("enter", "long")} style={canTrade ? { backgroundColor: sideColor("long"), color: "var(--accent-contrast)" } : undefined} className="rounded-lg px-4 py-4 text-left transition disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"><span className="block text-xs uppercase tracking-wider opacity-70">Add</span><span className="mt-0.5 block text-2xl font-semibold">Long ↗</span></button><button type="button" disabled={!canTrade} onClick={() => void sendAction("enter", "short")} style={canTrade ? { backgroundColor: sideColor("short"), color: "var(--accent-contrast)" } : undefined} className="rounded-lg px-4 py-4 text-left transition disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"><span className="block text-xs uppercase tracking-wider opacity-70">Add</span><span className="mt-0.5 block text-2xl font-semibold">Short ↘</span></button></div><p className="mt-3 text-center text-sm text-[var(--muted)]">Each press opens a new independent position at the server price.</p></div>}

      {phase === "settled" && <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Final price {view?.finalPrice === null ? "unavailable" : usd(view?.finalPrice ?? 0)}</p><p className="mt-1 text-2xl font-semibold text-[var(--text)]">{view?.winner === "tie" ? "Tie" : view?.winner === "you" ? "You won" : "Opponent won"} <span style={{ color: pnlColor(yourProfit) }}>{signedUsd(yourProfit)}</span></p></div><Link href="/duel" className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-center text-sm font-medium text-[var(--btn-text)]">Play Again</Link></div>}
      {error && <p className="pt-3 text-center text-xs text-[var(--negative)]">{error}</p>}
    </section>
    {phase === "open" || phase === "predict" ? <button type="button" onClick={() => void leave()} className="mx-auto mt-4 block text-xs uppercase tracking-wider text-[var(--muted-dim)] hover:text-[var(--text)]">Leave match</button> : null}
  </main>;
}

function PositionCard({ position, price, onClose, disabled }: { position: PulsePosition; price: number | null; onClose: () => void; disabled: boolean }) {
  const pnl = price === null ? 0 : pulsePositionsPnl([position], price);
  return <div className="rounded-md border border-[var(--line)] bg-[var(--surface-raised)] p-3"><div className="flex items-center justify-between gap-2"><strong style={{ color: sideColor(position.side) }}>{position.side.toUpperCase()}</strong><span className="text-sm tabular-nums" style={{ color: pnlColor(pnl) }}>{signedUsd(pnl)}</span></div><p className="mt-1 text-xs text-[var(--muted)]">Entry {usd(position.entryPrice)} · {usd(position.stake)} · {position.leverage}×</p><button type="button" disabled={disabled} onClick={onClose} className="mt-2 rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-50">Close position</button></div>;
}

function Score({ name, equity, pnl }: { name: string; equity: number; pnl: number }) {
  return <div className="min-w-0"><span className="truncate text-xs uppercase tracking-wider text-[var(--muted)]">{name}</span><div className="mt-1 text-lg font-semibold tabular-nums text-[var(--text)]">{usd(Math.max(0, equity))}</div><div className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: pnlColor(pnl) }}>{signedUsd(pnl)} P&amp;L</div></div>;
}
