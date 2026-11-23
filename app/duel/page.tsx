"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SignInAction, useAppAuth } from "@/app/auth/AuthProvider";
import { pickDailyCoin } from "@/app/DailyCoin";
import { LOBBY_WINDOW_MS } from "@/app/feedConfig";
import { FlameIcon } from "@/app/icons";
import { PortfolioGame } from "@/app/duel/portfolio/PortfolioGame";
import { hasFinishedTutorial, TUTORIAL_HREF } from "@/app/duel/tutorial/progress";
import { ArenaChart } from "@/app/duel/ArenaChart";
import { FeaturedMatchStrip, RecentResults, Skeleton, TopCallers, WinsTicker, type RecentResult } from "@/app/duel/ArenaParts";
import { MobileDeck } from "@/app/duel/MobileDeck";
import { betaModeEnabled } from "@/app/lib/betaMode";
import {
  getActiveMatch,
  setQueueing,
  subscribeActiveMatch,
  type ActiveMatch,
} from "@/app/lib/activeMatch";
import type { ArenaLobby, MarketStats } from "@/app/lib/arenaLobby";
import { getPlayerId } from "@/app/lib/playerId";
import { usePriceFeed } from "@/app/usePriceFeed";
import { clockLabel, priceAt, type ScrubPoint } from "@/app/MarketChart";
import { PULSE_DEFAULT_WAGER, PULSE_WAGER_OPTIONS } from "@/lib/pulse";

const TIMER_PRESETS = [
  { label: "60s", value: 60 },
  { label: "120s", value: 120 },
  { label: "300s", value: 300 },
];

// The open-match count is a lobby view, not a round — it can lag a poll or two.
const LOBBY_POLL_MS = 3000;
// Pressing Play holds you here, in an `open` match, until someone joins. The
// queue poll doubles as that match's presence heartbeat, so it runs at round
// speed rather than lobby speed — a slower beat would age the row out of the
// very list it is waiting to be found in (lib/match.ts PRESENCE_MS).
const QUEUE_POLL_MS = 1000;
// Wins ticker, featured match, top callers, players online (GET /api/arena/lobby).
const ARENA_POLL_MS = 5000;
// The other markets' 24h % on the switcher (GET /api/market-stats).
const STATS_POLL_MS = 30_000;
// Stacked avatars in the Opponent section before the "+N".
const STACKED_AVATARS = 3;

// Cents by default; pass the market's tick size so a sub-dollar coin's finer
// quote increment isn't rounded away.
const usd = (value: number, tickSize = 0.01) => {
  const decimals = Math.max(2, Math.round(-Math.log10(tickSize)));
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const pct = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(Math.abs(value) < 0.1 ? 3 : 2)}%`;

type Queue = {
  matchId: string;
  market: MarketId;
  mode: string;
  wager: number;
  timerSeconds: number;
  since: number;
};

type OpenMatch = {
  id: string;
  market: string;
  mode: string;
  wager: number;
  timerSeconds: number;
  createdAt: number;
  isYours: boolean;
};

type ModeId = "pulse" | "battle-24h";
type MarketId = "btc" | "eth" | "nvda";

const MARKETS: Record<MarketId, { label: string; name: string; tickSize: number }> = {
  btc: { label: "BTC", name: "BTC-USD", tickSize: 0.01 },
  eth: { label: "ETH", name: "ETH-USD", tickSize: 0.01 },
  nvda: { label: "NVDA", name: "NVDA-USD", tickSize: 0.01 },
};
// NVDA leads on the left; the pills after it sit together at the right edge
// (.arena-market-pill.is-right-start, app/globals.css).
const MARKET_ORDER: MarketId[] = ["nvda", "btc", "eth"];

// Pulse goes through matchmaking on every market; 24h Portfolio is its own page.
const MODES: { id: ModeId; label: string; href?: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "battle-24h", label: "24h Portfolio", href: "/duel/portfolio" },
];

const roundLength = (seconds: number) => (seconds >= 120 ? `${seconds / 60} min` : `${seconds}s`);

const windowLabel = (ms: number) => (ms >= 60_000 ? `last ${Math.round(ms / 60_000)} min` : `last ${Math.max(1, Math.round(ms / 1000))}s`);

type Volatility = "low" | "average" | "high";
const VOLATILITY_LABEL: Record<Volatility, string> = { low: "Low", average: "Average", high: "High" };
// 6h realized volatility (`vol6h` off /api/market-stats, % over the window):
// under LOW reads calm, over HIGH reads wild; one scale for every coin. A
// steady ~45%/yr coin like BTC sits near 1.2% over 6h.
const VOL_LOW_PCT = 0.6;
const VOL_HIGH_PCT = 1.5;

const volatilityLevel = (volPct: number): Volatility =>
  volPct < VOL_LOW_PCT ? "low" : volPct > VOL_HIGH_PCT ? "high" : "average";

/** "$60,069" and ".49", so the cents can sit dimmer than the dollars. */
function splitPrice(text: string) {
  const dot = text.lastIndexOf(".");
  return dot === -1 ? [text, ""] : [text.slice(0, dot), text.slice(dot)];
}

export default function Page() {
  const { isSignedIn } = useAppAuth();
  const router = useRouter();
  const [market, setMarket] = useState<MarketId>("nvda");
  const dailyCoinId = pickDailyCoin().toLowerCase() as MarketId;
  const activeMarket = MARKETS[market];
  const { price, points, status, now, day } = usePriceFeed(activeMarket.name, { windowMs: LOBBY_WINDOW_MS });
  // While the chart is being scrubbed, the headline reads the scrubbed point.
  const [scrub, setScrub] = useState<ScrubPoint>(null);
  const [timer, setTimer] = useState(60);
  // Embers each side puts in; matchmaking only pairs identical wagers.
  const [wager, setWager] = useState<number>(PULSE_DEFAULT_WAGER);
  const [mode, setMode] = useState<ModeId>("pulse");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [pending, setPending] = useState<"play" | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  // Set while this browser is sitting in its own `open` match. The room is
  // only entered once an opponent takes the seat.
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queuedFor, setQueuedFor] = useState(0);
  // A live match elsewhere blocks queueing/joining another one here — the
  // global ActiveMatchBar is the only way back into it.
  const [activeMatch, setActiveMatchState] = useState<ActiveMatch | null>(null);
  const [inviteState, setInviteState] = useState<"idle" | "shared" | "copied" | "error">("idle");
  // null until loaded; finishing a match navigates back here, which remounts and refetches.
  const [recentResults, setRecentResults] = useState<RecentResult[] | null>(null);
  // First-timer nudge toward the tutorial; read after mount (localStorage), so it never flashes for players who finished it.
  const [tutorialNudge, setTutorialNudge] = useState(false);
  // null until the first poll lands (skeletons until then).
  const [lobby, setLobby] = useState<{ data: ArenaLobby; receivedAt: number } | null>(null);
  const [marketStats, setMarketStats] = useState<MarketStats>({});
  // Beta mode hides the 24h Portfolio.
  const modes = betaModeEnabled() ? MODES.filter((option) => option.id !== "battle-24h") : MODES;
  const activeMode = modes.find((option) => option.id === mode) ?? modes[0];
  const isPulse = mode === "pulse";
  // The chart's head (bid/ask midpoint), so the headline matches the pill.
  const livePrice = points.at(-1)?.p ?? price;
  const currentPrice = scrub?.p ?? livePrice;
  // Flash the headline green/red when the live price moves a whole tick.
  const liveTicks = livePrice === null ? null : Math.round(livePrice / activeMarket.tickSize);
  const prevTicks = useRef<number | null>(null);
  const [priceFlash, setPriceFlash] = useState({ key: 0, dir: "up" as "up" | "down" });
  useEffect(() => {
    const prev = prevTicks.current;
    prevTicks.current = liveTicks;
    if (prev === null || liveTicks === null || prev === liveTicks) return;
    setPriceFlash((f) => ({ key: f.key + 1, dir: liveTicks > prev ? "up" : "down" }));
  }, [liveTicks]);
  useEffect(() => { prevTicks.current = null; }, [market]);
  // Change is measured from the chart's left edge — or the oldest point, while
  // the series hasn't filled the window yet, and the label says how far back.
  const windowStart = Math.max(now - LOBBY_WINDOW_MS, points[0]?.t ?? now);
  const firstPrice = priceAt(points, windowStart);
  const changeAbs = currentPrice !== null && firstPrice ? currentPrice - firstPrice : null;
  const change = changeAbs !== null && firstPrice ? (changeAbs / firstPrice) * 100 : null;
  const coveredMs = (scrub?.t ?? now) - windowStart;
  const dayChange = day && livePrice !== null ? ((livePrice - day.open) / day.open) * 100 : null;
  const vol6h = marketStats[market]?.vol6h ?? null;
  const volatility = vol6h === null ? null : volatilityLevel(vol6h);
  const players = lobby?.data.playersOnline;

  useEffect(() => setPlayerId(getPlayerId()), []);
  useEffect(() => setTutorialNudge(!hasFinishedTutorial()), []);

  useEffect(() => {
    setActiveMatchState(getActiveMatch());
    return subscribeActiveMatch(() => setActiveMatchState(getActiveMatch()));
  }, []);

  // The queue panel is this page's own "waiting for an opponent" UI, so the
  // global return-to-match bar steps aside while it's showing.
  useEffect(() => {
    setQueueing(Boolean(queue));
    return () => setQueueing(false);
  }, [queue]);

  // Only poll the lobby (the Opponent "waiting" count; the route also keeps
  // house bots seated) while Pulse is on screen.
  useEffect(() => {
    if (!isPulse) return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const query = new URLSearchParams({ market, mode: "pulse" });
        if (playerId) query.set("playerId", playerId);
        const res = await fetch(`/api/match/open?${query}`, { cache: "no-store" });
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { matches: OpenMatch[] };
          if (!cancelled) setOpenMatches(data.matches);
        }
      } catch {
        // Keep the last list rather than blanking the panel on a blip.
      }
      if (!cancelled) timerId = setTimeout(poll, LOBBY_POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [market, isPulse, playerId]);

  // Wins ticker, featured match, leaders and players online. A failed first
  // poll settles on an empty lobby so skeletons don't spin forever.
  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/arena/lobby?market=${market}`, { cache: "no-store" });
          if (!res.ok) throw new Error();
          const data = (await res.json()) as ArenaLobby;
          if (!cancelled) setLobby({ data, receivedAt: Date.now() });
        } catch {
          if (!cancelled) {
            setLobby((prev) => prev ?? { data: { wins: [], featured: null, leaders: [], playersOnline: null, serverNow: Date.now() }, receivedAt: Date.now() });
          }
        }
      }
      if (!cancelled) timerId = setTimeout(poll, ARENA_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [market]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/market-stats", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<MarketStats>) : null))
        .then((data) => { if (!cancelled && data) setMarketStats(data); })
        .catch(() => { /* The pills just keep their last figures. */ });
    load();
    const id = setInterval(load, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    fetch("/api/match/recent", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ results: RecentResult[] }>) : null))
      .then((data) => { if (!cancelled && data) setRecentResults(data.results); })
      .catch(() => { /* Leave the list as it was; it's history, not live state. */ });
    return () => { cancelled = true; };
  }, [isSignedIn]);

  const matchHref = (matchMarket: string, matchId: string) =>
    `/duel/${matchMarket}/pulse/${matchId}`;

  const inviteHref = queue
    ? `${matchHref(queue.market, queue.matchId)}?invite=1`
    : null;

  const practiceHref = `/duel/btc/pulse?practice=1&market=${market}`;

  const shareInvite = async () => {
    if (!inviteHref || !queue) return;
    const url = `${window.location.origin}${inviteHref}`;
    setInviteState("idle");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join my Prophecy arena",
          text: `Tap to play a ${MARKETS[queue.market].label} Pulse arena against me.`,
          url,
        });
        setInviteState("shared");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setInviteState("copied");
      } else {
        throw new Error("Sharing is not supported");
      }
    } catch (error) {
      // Closing the native share sheet is not an error worth showing.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setInviteState("error");
    }
  };

  const enterMatch = useCallback(
    (matchMarket: string, matchId: string) =>
      router.push(matchHref(matchMarket, matchId)),
    [router],
  );

  // Pressing Play either takes a seat someone was holding — straight into the
  // room — or opens a match and waits here. Nobody enters a room alone.
  const play = async () => {
    if (!playerId || !isSignedIn || pending || queue || activeMatch) return;
    setPending("play");
    setMatchError(null);
    try {
      const res = await fetch("/api/match/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          market,
          mode: "pulse",
          wager,
          timerSeconds: timer,
        }),
      });
      if (!res.ok) throw new Error(res.status === 402 ? "insufficient" : "no match");
      const { matchId, status: matchStatus } = (await res.json()) as {
        matchId: string;
        status: string;
      };
      if (matchStatus === "open") {
        setQueue({ matchId, market, mode: "pulse", wager, timerSeconds: timer, since: Date.now() });
        setQueuedFor(0);
        setPending(null);
        return;
      }
      enterMatch(market, matchId);
    } catch (error) {
      setMatchError(error instanceof Error && error.message === "insufficient"
        ? "Not enough coins for that wager."
        : isSignedIn ? "Could not reach the lobby. Try again." : "Sign in to wager your balance.");
      setPending(null);
    }
  };

  // While queued, this poll is the only thing keeping the match visible to
  // other players: `GET /api/match/[id]` stamps the heartbeat as it reads.
  useEffect(() => {
    if (!queue || !playerId) return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    // The 5s pre-round countdown starts the moment the opponent joins, so the room is
    // warmed here rather than paid for out of that budget.
    router.prefetch(matchHref(queue.market, queue.matchId));

    const tick = () => setQueuedFor(Math.round((Date.now() - queue.since) / 1000));

    const poll = async () => {
      tick();
      try {
        const res = await fetch(
          `/api/match/${encodeURIComponent(queue.matchId)}?playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.status === 404) {
          setQueue(null);
          setMatchError("Your match disappeared. Press Play to open another.");
          return;
        }
        if (res.ok) {
          const view = (await res.json()) as { status: string };
          if (cancelled) return;
          // Anything but `open` means someone took the seat — go play.
          if (view.status !== "open") {
            setQueue(null);
            enterMatch(queue.market, queue.matchId);
            return;
          }
        }
      } catch {
        // Transient failure: keep waiting rather than dropping the queue.
      }
      if (!cancelled) timerId = setTimeout(poll, QUEUE_POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [queue, playerId, enterMatch, router]);

  useEffect(() => {
    setInviteState("idle");
  }, [queue?.matchId]);

  const cancelQueue = async () => {
    if (!queue) return;
    const { matchId } = queue;
    setQueue(null);
    setMatchError(null);
    try {
      await fetch(`/api/match/${encodeURIComponent(matchId)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
    } catch {
      // Best-effort; the row ages out of the lobby on its own either way.
    }
  };

  const queuePanel = queue && (
    <section className="arena-queue" aria-live="polite">
      <span className="arena-queue-pulse" aria-hidden="true" />
      <div className="arena-queue-copy">
        <span className="arena-eyebrow">In queue</span>
        <strong>Waiting for an opponent…</strong>
        <span className="arena-muted">
          {MARKETS[queue.market].label} Pulse · {queue.timerSeconds}s round · {queue.wager} Embers each, winner takes {queue.wager * 2}
        </span>
      </div>
      <span className="arena-queue-elapsed arena-mono">{queuedFor}s</span>
      <div className="arena-queue-actions">
        <button type="button" className="arena-ghost-button" onClick={shareInvite}>
          {inviteState === "shared" ? "Shared" : inviteState === "copied" ? "Copied" : "Share invite"}
        </button>
        <button type="button" className="arena-ghost-button is-quiet" onClick={cancelQueue}>Cancel</button>
      </div>
      {inviteState === "error" && <span className="arena-muted arena-note">Copy the link from your browser address bar.</span>}
    </section>
  );

  const [priceWhole, priceCents] = currentPrice === null ? ["", ""] : splitPrice(usd(currentPrice, activeMarket.tickSize));
  const statusLabel = status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting" : "Connecting";
  const waiting = openMatches.length;

  return (
    <main className="arena" data-market={market}>
      <h1 className="sr-only">Arena</h1>

      {lobby && <WinsTicker wins={lobby.data.wins} now={now} />}

      <div className="arena-toolbar">
        {/* Beta mode leaves Pulse as the only mode, so there's nothing to choose. */}
        {modes.length > 1 && (
          <div className="arena-modes" role="group" aria-label="Choose a mode">
            {modes.map((option) => (
              <button key={option.id} type="button" aria-pressed={option.id === mode} onClick={() => setMode(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
        )}
        {isPulse && (
          <>
            {modes.length > 1 && <span className="arena-toolbar-divider" aria-hidden="true" />}
            <nav className="arena-markets" aria-label="Market switcher">
              {MARKET_ORDER.map((id, index) => {
                const selected = id === market;
                const stats = marketStats[id];
                const dayPct = selected && dayChange !== null ? dayChange : stats ? ((stats.last - stats.open) / stats.open) * 100 : null;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`arena-market-pill${index === 1 ? " is-right-start" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setMarket(id)}
                    style={{ "--coin": `var(--market-${id})` } as CSSProperties}
                  >
                    <span className="arena-coin-dot" aria-hidden="true" />
                    <span className="arena-market-symbol">{MARKETS[id].label}</span>
                    {dayPct === null ? (
                      <Skeleton style={{ width: 44, height: 10 }} />
                    ) : (
                      <span className={`arena-market-change arena-mono ${dayPct >= 0 ? "is-up" : "is-down"}`}>
                        <span className="sr-only">24 hour change </span>{pct(dayPct)}
                      </span>
                    )}
                    {id === dailyCoinId && <span className="arena-daily-tag" title="Daily coin, rotates by day of the year">Daily</span>}
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </div>

      {isPulse ? (
        <div className="arena-stage">
          <section className="arena-card arena-chart-card" aria-label={`${activeMarket.label} live chart`}>
            <div className="arena-price-head">
              <div className="arena-price-copy">
                <div className="arena-price-eyebrow">
                  <span>{activeMarket.label} / USD</span>
                  <span className={`arena-live-badge is-${status}`} role="status">
                    <span className="arena-live-dot" aria-hidden="true" />{statusLabel}
                  </span>
                  {volatility ? (
                    <span
                      className={`arena-vol-badge is-${volatility}`}
                      title={`Last 6h realized volatility ${vol6h?.toFixed(2)}% (low under ${VOL_LOW_PCT}%, high over ${VOL_HIGH_PCT}%)`}
                    >
                      Volatility: <strong>{VOLATILITY_LABEL[volatility]}</strong>
                    </span>
                  ) : (
                    // Placeholder only until the first stats poll lands; a market with no 6h figure shows nothing.
                    !marketStats[market] && <Skeleton className="arena-vol-badge-skel" style={{ width: 112, height: 18 }} />
                  )}
                </div>
                <div className="arena-price arena-mono">
                  {currentPrice === null ? (
                    <Skeleton style={{ width: 240, height: 40 }} />
                  ) : (
                    <span key={priceFlash.key} className={priceFlash.key > 0 && !scrub ? `arena-price-flash is-${priceFlash.dir}` : undefined}>
                      {priceWhole}<span className="arena-price-cents">{priceCents}</span>
                    </span>
                  )}
                </div>
                <div className="arena-price-change">
                  {change === null || changeAbs === null ? (
                    <Skeleton style={{ width: 180, height: 14 }} />
                  ) : (
                    <span className={`arena-mono ${changeAbs >= 0 ? "is-up" : "is-down"}`}>
                      <span aria-hidden="true">{changeAbs >= 0 ? "▲" : "▼"} </span>
                      {changeAbs >= 0 ? "+" : "−"}{usd(Math.abs(changeAbs), activeMarket.tickSize)} ({pct(change)})
                    </span>
                  )}
                  <span className="arena-muted">{scrub ? clockLabel(scrub.t) : windowLabel(coveredMs)}</span>
                </div>
              </div>
              <dl className="arena-stats">
                <div>
                  <dt>24h high</dt>
                  <dd className="arena-mono">{day ? usd(day.high, activeMarket.tickSize) : <Skeleton style={{ width: 72, height: 12 }} />}</dd>
                </div>
                <div>
                  <dt>24h low</dt>
                  <dd className="arena-mono">{day ? usd(day.low, activeMarket.tickSize) : <Skeleton style={{ width: 72, height: 12 }} />}</dd>
                </div>
                <div>
                  <dt>24h change</dt>
                  <dd className={`arena-mono${dayChange === null ? "" : dayChange >= 0 ? " is-up" : " is-down"}`}>
                    {dayChange === null ? <Skeleton style={{ width: 56, height: 12 }} /> : pct(dayChange)}
                  </dd>
                </div>
                <div>
                  <dt title="Signed-in players with Prophecy open">Players</dt>
                  <dd className="arena-mono">
                    {players === undefined ? <Skeleton style={{ width: 40, height: 12 }} /> : players === null ? "—" : players.toLocaleString("en-US")}
                  </dd>
                </div>
              </dl>
            </div>

            {lobby && <FeaturedMatchStrip match={lobby.data.featured} receivedAt={lobby.receivedAt} />}

            <div className="arena-chart-wrap">
              <ArenaChart points={points} now={now} label={activeMarket.label} tickSize={activeMarket.tickSize} onScrub={setScrub} />
            </div>
          </section>

          <aside className="arena-card arena-call" aria-labelledby="arena-call-title">
            <div className="arena-call-head">
              <span className="arena-eyebrow">Make a call</span>
              <div className="arena-call-title">
                <h2 id="arena-call-title" className="arena-wordmark">Pulse</h2>
                <span className="arena-muted">{activeMarket.label} · head to head · trade live</span>
              </div>
            </div>

            {tutorialNudge && !queue && (
              <Link href={TUTORIAL_HREF} className="arena-tutorial">
                <span className="arena-tutorial-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l12-7.5z" /></svg>
                </span>
                <span className="arena-tutorial-copy">
                  <strong>New to Pulse?</strong>
                  <span className="arena-muted">Learn it in a few minutes with practice money.</span>
                </span>
                <span className="arena-tutorial-cta">Start <span aria-hidden="true">→</span></span>
              </Link>
            )}

            {queue ? queuePanel : (
              <>
                <div className="arena-field">
                  <span className="arena-eyebrow" id="arena-timer-label">Round length</span>
                  <div className="arena-segments" role="group" aria-labelledby="arena-timer-label">
                    {TIMER_PRESETS.map((preset) => (
                      <button key={preset.value} type="button" aria-pressed={timer === preset.value} onClick={() => setTimer(preset.value)}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="arena-field">
                  <span className="arena-eyebrow" id="arena-wager-label">Wager</span>
                  <div className="arena-segments" role="group" aria-labelledby="arena-wager-label">
                    {PULSE_WAGER_OPTIONS.map((option) => (
                      <button key={option} type="button" aria-pressed={wager === option} onClick={() => setWager(option)}>
                        <FlameIcon className="arena-ember" /> {option}
                        <span className="sr-only"> Embers</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="arena-payout">
                  <div>
                    <span className="arena-muted">You stake</span>
                    <strong className="arena-mono"><FlameIcon className="arena-ember" />{wager}</strong>
                  </div>
                  <svg className="arena-payout-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  <div className="is-end">
                    <span className="arena-muted">Winner takes</span>
                    <strong className="arena-mono is-pot"><FlameIcon className="arena-ember" />{wager * 2}</strong>
                  </div>
                </div>
                <p className="arena-payout-note">{roundLength(timer)} round · higher P&amp;L at the bell takes the pot</p>

                <div className="arena-opponent">
                  {waiting > 0 && (
                    <span className="arena-stack" aria-hidden="true">
                      {openMatches.slice(0, STACKED_AVATARS).map((match, i) => (
                        <span key={match.id} className="arena-stack-face" style={{ "--i": i } as CSSProperties}>
                          <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="9" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
                        </span>
                      ))}
                      {waiting > STACKED_AVATARS && <span className="arena-stack-face is-more">+{waiting - STACKED_AVATARS}</span>}
                    </span>
                  )}
                  <div>
                    <strong>Open lobby</strong>
                    <span className="arena-muted">{waiting} Pulse match{waiting === 1 ? "" : "es"} waiting</span>
                  </div>
                </div>
              </>
            )}

            <div className="arena-call-actions">
              {!queue && (isSignedIn === false
                // Signed out: still the bright call to action — it opens sign-in.
                ? <SignInAction><button type="button" className="arena-play">Sign in to play <span aria-hidden="true">→</span></button></SignInAction>
                : <button type="button" className="arena-play" onClick={play} disabled={!playerId || !isSignedIn || pending !== null || activeMatch !== null}>{pending === "play" ? "Finding a match…" : <>Play <span aria-hidden="true">→</span></>}</button>)}
              <Link href={practiceHref} className="arena-practice">Practice with play money</Link>
              {activeMatch ? (
                <span className="arena-muted arena-note">Finish your live arena before starting another.</span>
              ) : (
                matchError && <span className="arena-muted arena-note">{matchError}</span>
              )}
            </div>
          </aside>

          {/* Phones (≤640px) get this instead of the aside above — CSS swaps them. */}
          <MobileDeck
            timerPresets={TIMER_PRESETS}
            timer={timer}
            onTimer={setTimer}
            wagerOptions={PULSE_WAGER_OPTIONS}
            wager={wager}
            onWager={setWager}
            waiting={waiting}
            isSignedIn={isSignedIn}
            canPlay={Boolean(playerId) && Boolean(isSignedIn) && pending === null && activeMatch === null}
            pending={pending === "play"}
            onPlay={play}
            practiceHref={practiceHref}
            tutorialHref={TUTORIAL_HREF}
            tutorialNudge={tutorialNudge && !queue}
            queuePanel={queuePanel}
            note={activeMatch ? "Finish your live arena before starting another." : matchError}
            leaders={lobby ? lobby.data.leaders : null}
            results={recentResults}
            now={now}
          />
        </div>
      ) : (
        <div className="arena-portfolio">
          {queue ? <div className="arena-card">{queuePanel}</div> : activeMode.href ? <PortfolioGame /> : null}
        </div>
      )}

      {isPulse && (
        <section className="arena-bottom">
          <TopCallers leaders={lobby ? lobby.data.leaders : null} />
          <RecentResults isSignedIn={isSignedIn} results={recentResults} now={now} />
        </section>
      )}
    </main>
  );
}
