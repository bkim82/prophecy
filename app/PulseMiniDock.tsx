"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePriceFeed } from "./usePriceFeed";
import { activeMatchHref, type ActiveMatch } from "./lib/activeMatch";
import type { MatchView } from "@/lib/match";
import {
  pulseAvailableCash,
  pulsePositionsPnl,
  PULSE_LEVERAGE_OPTIONS,
  type PulseSide,
} from "@/lib/pulse";
import { productForMarket } from "@/lib/spotPrice";

const STAKE_OPTIONS = [10, 25, 50];
type Action = "enter" | "close";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");
const sideColor = (side: PulseSide) => (side === "long" ? "var(--chart-up)" : "var(--chart-down)");
const formatTime = (s: number) =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

/**
 * Condensed Pulse trading controls rendered inside the global ActiveMatchBar
 * so a live round can be traded from anywhere in the app without leaving the
 * page. Mounted for the lifetime of the countdown phase (not just while
 * visible) so its price feed is already warm the moment it's shown.
 */
export function PulseMiniDock({
  match,
  view,
  playerId,
  visible,
  onApply,
}: {
  match: ActiveMatch;
  view: MatchView;
  playerId: string;
  visible: boolean;
  onApply: (next: MatchView) => void;
}) {
  const product = productForMarket(match.market) ?? "BTC-USD";
  const { price } = usePriceFeed(product);
  const [stake, setStake] = useState(25);
  const [leverage, setLeverage] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const skewRef = useRef(0);
  skewRef.current = view.serverNow - Date.now();

  useEffect(() => {
    const deadline = view.deadlineAt;
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - skewRef.current - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.deadlineAt, view.serverNow]);

  const positions = view.pulseYourPositions;
  const availableCash = pulseAvailableCash(positions, view.pulseYourRealizedPnl);
  const canTrade = view.status === "countdown" && price !== null && !busy;

  const sendAction = useCallback(
    async (action: Action, side?: PulseSide, positionId?: string) => {
      if (busy || view.status !== "countdown" || price === null) return;
      if (action === "enter" && stake > availableCash) {
        setError("Not enough balance for that stake.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/match/${encodeURIComponent(match.matchId)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId, action, side, positionId, stake, leverage }),
        });
        if (!res.ok) throw new Error();
        onApply((await res.json()) as MatchView);
      } catch {
        setError("Couldn't sync that trade — try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, view.status, price, stake, availableCash, leverage, match.matchId, playerId, onApply],
  );

  return (
    <div className="pulse-mini-dock" style={{ display: visible ? "flex" : "none" }}>
      <div className="pulse-mini-dock-head">
        <span className="pulse-mini-dock-balance">{usd(availableCash)}</span>
        <span className="pulse-mini-dock-timer">{formatTime(secondsLeft ?? 0)}</span>
      </div>

      {positions.length > 0 && (
        <div className="pulse-mini-dock-positions">
          {positions.map((position) => {
            const pnl = price === null ? 0 : pulsePositionsPnl([position], price);
            return (
              <div key={position.id} className="pulse-mini-dock-position">
                <span style={{ color: sideColor(position.side) }}>{position.side === "long" ? "↗ Long" : "↘ Short"}</span>
                <span className="pnl" style={{ color: pnlColor(pnl) }}>{signedUsd(pnl)}</span>
                <button
                  type="button"
                  disabled={!canTrade}
                  onClick={() => void sendAction("close", undefined, position.id)}
                  aria-label="Close position"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="pulse-mini-dock-row">
        {STAKE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={option > availableCash || !canTrade}
            onClick={() => setStake(option)}
            className={stake === option ? "active" : ""}
          >
            {usd(option)}
          </button>
        ))}
      </div>
      <div className="pulse-mini-dock-row">
        {PULSE_LEVERAGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={!canTrade}
            onClick={() => setLeverage(option)}
            className={leverage === option ? "active" : ""}
          >
            {option}×
          </button>
        ))}
      </div>
      <div className="pulse-mini-dock-actions">
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => void sendAction("enter", "long")}
          style={canTrade ? { backgroundColor: sideColor("long"), color: "var(--accent-contrast)" } : undefined}
        >
          Long ↗
        </button>
        <button
          type="button"
          disabled={!canTrade}
          onClick={() => void sendAction("enter", "short")}
          style={canTrade ? { backgroundColor: sideColor("short"), color: "var(--accent-contrast)" } : undefined}
        >
          Short ↘
        </button>
      </div>
      {error && <p className="pulse-mini-dock-error">{error}</p>}
      <Link href={activeMatchHref(match)} className="pulse-mini-dock-link">Open full room →</Link>
    </div>
  );
}
