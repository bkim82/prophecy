"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClosedPositions } from "./ClosedPositions";
import { OpenPositions } from "./OpenPositions";
import type { TradeInput } from "./OrderForm";
import { PortfolioSummary } from "./PortfolioSummary";
import { BuyingPower, SessionStrip, SessionStripSkeleton, StartPanel } from "./SessionStrip";
import { SessionHistory } from "./SessionHistory";
import { TokenDetail } from "./TokenDetail";
import { TokenExplorer } from "./TokenExplorer";
import type { OpenPositionView, SessionState, TokenSearchResult } from "./types";

const POLL_MS = 3000;
const TICK_MS = 1000;
const FRESH_MS = 2200;

/** Below `lg`, the three columns become Explore / Portfolio tabs plus a token detail screen. */
type MobileView = "explore" | "detail" | "portfolio";

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
  const [selected, setSelected] = useState<TokenSearchResult | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("explore");
  const [freshId, setFreshId] = useState<string | null>(null);

  const skewRef = useRef(0);
  const wasActiveRef = useRef(false);
  const pollNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!freshId) return;
    const id = setTimeout(() => setFreshId(null), FRESH_MS);
    return () => clearTimeout(id);
  }, [freshId]);

  const selectToken = useCallback((token: TokenSearchResult) => {
    setSelected(token);
    setMobileView("detail");
  }, []);
  const autoSelectToken = useCallback((token: TokenSearchResult) => setSelected((current) => current ?? token), []);
  const applyQuote = useCallback(
    (fresh: TokenSearchResult) => setSelected((current) => (current?.address === fresh.address ? { ...current, ...fresh } : current)),
    [],
  );

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

    pollNowRef.current = () => {
      clearTimeout(timer);
      poll();
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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        position?: { id: string; qty: number | null; entryPrice: number; openedAt: string };
      };
      if (!res.ok || !data.position) {
        setTradeError(data.error ?? "Could not open that position.");
        return false;
      }
      // Confirmed by the server: show the position now (marked at its fill
      // price) and poll right away for live P&L and the new available cash.
      const filled = data.position;
      const view: OpenPositionView = {
        id: filled.id,
        kind: input.kind,
        tokenAddress: input.token.address,
        tokenSymbol: input.token.symbol,
        tokenName: input.token.name,
        side: input.side,
        leverage: input.leverage,
        qty: filled.qty,
        entryPrice: filled.entryPrice,
        committedCash: input.amount,
        markPrice: filled.entryPrice,
        unrealizedPnl: 0,
        priceStale: false,
        openedAt: filled.openedAt,
        imageUrl: input.token.imageUrl,
        change24h: input.token.change24h,
      };
      setState((prev) =>
        prev.positions.some((position) => position.id === view.id) ? prev : { ...prev, positions: [view, ...prev.positions] },
      );
      setFreshId(view.id);
      pollNowRef.current();
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
  const ownedAddresses = Array.from(new Set(state.positions.map((position) => position.tokenAddress)));
  const tab = (view: MobileView) => (mobileView === view ? "" : "max-lg:hidden");

  return (
    <div className="portfolio-game space-y-4">
      {!loaded ? (
        <SessionStripSkeleton />
      ) : session ? (
        <SessionStrip session={session} openPnl={openPnl} countdownMs={countdownMs} />
      ) : (
        <StartPanel busy={startBusy} error={startError} onStart={startSession} />
      )}

      {session && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface)] p-1 lg:hidden" role="tablist" aria-label="Portfolio view">
            {(["explore", "portfolio"] as const).map((view) => {
              const active = view === "portfolio" ? mobileView === "portfolio" : mobileView !== "portfolio";
              return (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMobileView(view)}
                  className={`min-h-10 rounded-md text-sm font-semibold transition-colors ${active ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--muted)]"}`}
                >
                  {view === "explore" ? "Explore" : `Portfolio${state.positions.length > 0 ? ` · ${state.positions.length}` : ""}`}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,28fr)_minmax(0,44fr)_minmax(0,28fr)]">
            {/* Side columns take the token profile's height (absolute fill) and scroll inside it. */}
            <div className={`lg:relative ${tab("explore")}`}>
              <TokenExplorer selected={selected} onSelect={selectToken} onAutoSelect={autoSelectToken} ownedAddresses={ownedAddresses} />
            </div>
            <div className={tab("detail")}>
              <TokenDetail
                token={selected}
                onQuote={applyQuote}
                positions={state.positions}
                availableCash={session.availableCash}
                sessionEnded={countdownMs <= 0}
                busy={tradeBusy}
                error={tradeError}
                onSubmit={openPosition}
                now={nowTick}
                onBack={() => setMobileView("explore")}
                onViewPortfolio={() => setMobileView("portfolio")}
              />
            </div>
            <div className={`lg:relative ${tab("portfolio")}`}>
            <section className="flex min-h-0 flex-col rounded-xl bg-[var(--surface)] p-4 lg:absolute lg:inset-0" aria-label="Your portfolio">
              <BuyingPower session={session} />
              <div className="-mx-1 mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
                <OpenPositions
                  positions={state.positions}
                  closingId={closingId}
                  closeError={closeError}
                  onClose={closePosition}
                  now={nowTick}
                  freshId={freshId}
                />
              </div>
            </section>
            </div>
          </div>

          <div className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-2 ${tab("portfolio")}`}>
            <PortfolioSummary positions={state.positions} availableCash={session.availableCash} openPnl={openPnl} />
            <ClosedPositions positions={state.closedPositions} />
          </div>
        </>
      )}

      <div className={session ? tab("portfolio") : ""}>
        <SessionHistory history={state.history} />
      </div>
    </div>
  );
}
