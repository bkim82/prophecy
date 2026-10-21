"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { signed } from "@/app/duel/portfolio/ui";
import { CloseIcon } from "@/app/icons";
import { signedPct } from "@/app/lib/calls";
import { playedLabel } from "@/app/lib/playedLabel";
import type { TradeReceipt } from "@/app/lib/trades";
import { TRADE_SOURCE, TradeCoin, TradeSide, tradeTone, useMinuteNow } from "@/app/TradeCard";

export type TradesState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error" }
  | { status: "ready"; trades: TradeReceipt[] };

/**
 * Your recent trades from GET /api/trades/recent, fetched as soon as the
 * composer mounts so the picker opens already filled. Signed-out comes from
 * the auth state (or a 401), not a request.
 */
export function useRecentTrades(): { state: TradesState; reload: () => void } {
  const { isLoaded, isSignedIn } = useAppAuth();
  const [result, setResult] = useState<TradesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    fetch("/api/trades/recent", { cache: "no-store" })
      .then(async (response): Promise<TradesState> => {
        if (response.status === 401) return { status: "signed-out" };
        if (!response.ok) return { status: "error" };
        const body = (await response.json()) as { trades: TradeReceipt[] };
        return { status: "ready", trades: body.trades };
      })
      .catch((): TradesState => ({ status: "error" }))
      .then((next) => {
        if (!cancelled) setResult(next);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, attempt]);

  const state: TradesState = !isLoaded ? { status: "loading" } : !isSignedIn ? { status: "signed-out" } : result;
  return {
    state,
    reload: () => {
      setResult({ status: "loading" });
      setAttempt((n) => n + 1);
    },
  };
}

// "2h ago · 24h Portfolio" / "5m ago · Won vs @zane" — time first so it
// survives truncation on phones; the side tag and Open badge say the rest.
function tradeLine(trade: TradeReceipt, now: number) {
  const when = now > 0 ? playedLabel(trade.at, now) : "";
  const detail =
    trade.source === "arena"
      ? `${trade.result === "won" ? "Won" : trade.result === "lost" ? "Lost" : "Tied"} vs ${trade.opponent ?? "Opponent"}`
      : TRADE_SOURCE[trade.source].label;
  return [when, detail].filter(Boolean).join(" · ");
}

/**
 * The Trade button's dropdown: your newest trades, one tap attaches one.
 * Arrow keys move between rows; Esc and outside clicks are handled by the
 * composer, which owns every toolbar popover.
 */
export function TradePicker({
  state,
  selectedId,
  onPick,
  onRetry,
  onClose,
}: {
  state: TradesState;
  selectedId: string | null;
  onPick: (trade: TradeReceipt) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { openSignIn } = useAppAuth();
  const now = useMinuteNow();
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus lands on the attached trade (else the newest) once rows exist.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      panelRef.current?.focus();
      return;
    }
    const rows = [...list.querySelectorAll<HTMLButtonElement>(".trade-pick")];
    (rows.find((row) => row.getAttribute("aria-current") === "true") ?? rows[0])?.focus();
  }, [state.status]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".trade-pick") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[next].focus();
  }

  return (
    <div className="compose-popover trade-picker" role="dialog" aria-label="Attach a trade" ref={panelRef} tabIndex={-1}>
      <div className="compose-popover-head">
        <div>
          <h2>Attach a trade</h2>
          <p>Your latest trades, straight from your account</p>
        </div>
        <button type="button" className="compose-popover-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {state.status === "loading" && (
        <div className="trade-picker-loading" aria-label="Loading your trades" role="status">
          {[0, 1, 2].map((i) => (
            <span key={i} className="trade-pick-skeleton">
              <span className="pf-shimmer" />
              <span className="pf-shimmer" />
              <span className="pf-shimmer" />
            </span>
          ))}
        </div>
      )}
      {state.status === "signed-out" && (
        <div className="trade-picker-empty">
          <p>Sign in to attach trades from your account.</p>
          <button type="button" className="trade-picker-cta" onClick={openSignIn}>
            Sign in
          </button>
        </div>
      )}
      {state.status === "error" && (
        <div className="trade-picker-empty" role="alert">
          <p>Couldn&apos;t load your trades.</p>
          <button type="button" className="trade-picker-cta" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && state.trades.length === 0 && (
        <div className="trade-picker-empty">
          <p>No trades yet. Play an Arena round or open a 24h Portfolio position and it shows up here.</p>
          <span className="trade-picker-links">
            <Link href="/duel" className="trade-picker-cta">
              Go to the Arena
            </Link>
            <Link href="/duel/portfolio" className="trade-picker-link">
              24h Portfolio
            </Link>
          </span>
        </div>
      )}
      {state.status === "ready" && state.trades.length > 0 && (
        <div className="trade-picker-list" ref={listRef} onKeyDown={moveFocus}>
          {state.trades.map((trade) => {
            const selected = trade.id === selectedId;
            return (
              <button
                key={trade.id}
                type="button"
                className="trade-pick"
                data-tone={tradeTone(trade)}
                aria-current={selected || undefined}
                onClick={() => onPick(trade)}
              >
                <TradeCoin trade={trade} size={34} />
                <span className="trade-pick-main">
                  <span className="trade-pick-title">
                    <strong>${trade.symbol}</strong>
                    <TradeSide trade={trade} />
                    {trade.open && <span className="trade-pick-open">Open</span>}
                  </span>
                  <span className="trade-pick-sub">{tradeLine(trade, now)}</span>
                </span>
                <span className="trade-pick-roi">
                  <strong>{signedPct(trade.roiPct)}</strong>
                  <span>{selected ? "✓ Attached" : `${signed(trade.pnl)} Embers`}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
