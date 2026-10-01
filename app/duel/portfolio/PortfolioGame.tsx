"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { ClosedPositions } from "./ClosedPositions";
import { OpenPositions } from "./OpenPositions";
import { PortfolioSummary } from "./PortfolioSummary";
import { SessionHero, SessionHeroSkeleton, StartPanel } from "./SessionHero";
import { SessionHistory } from "./SessionHistory";
import { TradeTicket, type TradeInput } from "./TradeTicket";
import type { SessionState } from "./types";

const POLL_MS = 3000;
const TICK_MS = 1000;

const EMPTY_STATE: SessionState = { serverNow: Date.now(), session: null, positions: [], closedPositions: [], history: [] };

/**
 * The whole 24h Portfolio game as one embeddable component — used by the
 * standalone /duel/portfolio room and rendered inline in the /duel lobby's
 * mode switcher when "24h Portfolio" is selected (same pattern the retired
 * Battle24h widget followed for 24h Reading).
 */
export function PortfolioGame() {
  const { isSignedIn, isLoaded } = useUser();
  const [state, setState] = useState<SessionState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const skewRef = useRef(0);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch("/api/portfolio/session", { cache: "no-store" });
        if (!cancelled && res.ok) {
          const next = (await res.json()) as SessionState;
          skewRef.current = next.serverNow - Date.now();
          if (wasActiveRef.current && next.session?.status !== "active") {
            window.dispatchEvent(new Event("balance-updated"));
          }
          wasActiveRef.current = next.session?.status === "active";
          setState(next);
          setLoaded(true);
        }
      } catch {
        // Keep the last state rather than blanking the panel on a blip.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoaded, isSignedIn]);

  const startSession = async (stake: number) => {
    if (startBusy) return;
    setStartBusy(true);
    setStartError(null);
    try {
      const res = await fetch("/api/portfolio/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake }),
      });
      const data = (await res.json().catch(() => ({}))) as { session?: SessionState["session"]; error?: string };
      if (!res.ok || !data.session) {
        setStartError(res.status === 402 ? "Not enough embers for that stake." : (data.error ?? "Could not start a session."));
        return;
      }
      wasActiveRef.current = true;
      setState((prev) => ({ ...prev, session: data.session! }));
      window.dispatchEvent(new Event("balance-updated"));
    } catch {
      setStartError("Could not reach the server. Try again.");
    } finally {
      setStartBusy(false);
    }
  };

  const openPosition = async (input: TradeInput): Promise<boolean> => {
    if (tradeBusy) return false;
    setTradeBusy(true);
    setTradeError(null);
    try {
      const res = await fetch("/api/portfolio/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: input.kind,
          tokenAddress: input.token.address,
          tokenSymbol: input.token.symbol,
          tokenName: input.token.name,
          side: input.side,
          leverage: input.leverage,
          amount: input.amount,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTradeError(data.error ?? "Could not open that position.");
        return false;
      }
      // The 3s poll picks up the new position; nothing to merge locally since
      // the response lacks the live mark price the list needs.
      return true;
    } catch {
      setTradeError("Could not reach the server. Try again.");
      return false;
    } finally {
      setTradeBusy(false);
    }
  };

  const closePosition = async (id: string) => {
    if (closingId) return;
    setClosingId(id);
    setCloseError(null);
    try {
      const res = await fetch(`/api/portfolio/positions/${encodeURIComponent(id)}/close`, { method: "POST" });
      if (res.ok) {
        window.dispatchEvent(new Event("balance-updated"));
        setState((prev) => ({ ...prev, positions: prev.positions.filter((position) => position.id !== id) }));
      } else if (res.status !== 409) {
        // 409 = already closed; the next poll reconciles that silently.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setCloseError(data.error === "Price unavailable" ? "Live price unavailable — try closing again in a moment." : (data.error ?? "Could not close that position."));
      }
    } catch {
      setCloseError("Could not reach the server. Try again.");
    } finally {
      setClosingId(null);
    }
  };

  if (isLoaded && !isSignedIn) {
    return (
      <div className="rounded-xl bg-[var(--surface)] px-5 py-8 text-center">
        <p className="text-xs uppercase tracking-wider text-[var(--muted)]">24h Portfolio</p>
        <h2 className="mt-1 text-lg font-medium text-[var(--text)]">Sign in to play</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Your sessions, positions and stats are tied to your account.</p>
        <div className="mt-4 flex items-center justify-center">
          <SignInButton mode="modal">
            <button className="min-h-11 rounded-lg bg-[var(--btn-bg)] px-5 text-sm font-semibold text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]">
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  const localEndAt = state.session ? state.session.endAt - skewRef.current : null;
  const countdownMs = localEndAt === null ? 0 : localEndAt - nowTick;
  const session = state.session?.status === "active" ? state.session : null;
  const openPnl = state.positions.reduce((total, position) => total + position.unrealizedPnl, 0);
  const recentAddresses = Array.from(
    new Set([...state.positions, ...state.closedPositions].map((position) => position.tokenAddress)),
  );

  return (
    <div className="portfolio-game space-y-6">
      {!loaded ? (
        <SessionHeroSkeleton />
      ) : session ? (
        <SessionHero session={session} openPnl={openPnl} countdownMs={countdownMs} />
      ) : (
        <StartPanel busy={startBusy} error={startError} onStart={startSession} />
      )}

      {session && (
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]">
          <TradeTicket
            availableCash={session.availableCash}
            sessionEnded={countdownMs <= 0}
            busy={tradeBusy}
            error={tradeError}
            onSubmit={openPosition}
            positions={state.positions}
            closingId={closingId}
            onClose={closePosition}
            recentAddresses={recentAddresses}
          />
          <div className="space-y-4">
            <OpenPositions positions={state.positions} closingId={closingId} closeError={closeError} onClose={closePosition} now={nowTick} />
            <PortfolioSummary positions={state.positions} availableCash={session.availableCash} openPnl={openPnl} />
            <ClosedPositions positions={state.closedPositions} />
          </div>
        </div>
      )}

      <SessionHistory history={state.history} />
    </div>
  );
}
