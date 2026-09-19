"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Battle24h } from "@/app/Battle24h";
import { DailyCoin, pickDailyCoin } from "@/app/DailyCoin";
import {
  getActiveMatch,
  setQueueing,
  subscribeActiveMatch,
  type ActiveMatch,
} from "@/app/lib/activeMatch";
import { getPlayerId } from "@/app/lib/playerId";
import { usePriceFeed } from "@/app/usePriceFeed";

const WAGER_PRESETS = [10, 100, 1000];
const TIMER_PRESETS = [
  { label: "60s", value: 60 },
  { label: "120s", value: 120 },
  { label: "300s", value: 300 },
];

// The open-match list is a lobby view, not a round — it can lag a poll or two.
const LOBBY_POLL_MS = 3000;
// Pressing Play holds you here, in an `open` match, until someone joins. The
// queue poll doubles as that match's presence heartbeat, so it runs at round
// speed rather than lobby speed — a slower beat would age the row out of the
// very list it is waiting to be found in (lib/match.ts PRESENCE_MS).
const QUEUE_POLL_MS = 1000;

const usd = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const age = (since: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
};

function MiniChart({ points }: { points: { t: number; p: number }[] }) {
  const chart = useMemo(() => {
    const fallback = [67110, 67142, 67125, 67188, 67164, 67230, 67208, 67276, 67254, 67318, 67304, 67355];
    const values = points.length > 1 ? points.slice(-36).map((point) => point.p) : fallback;
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 1;
    const linePoints = values.map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 90 - ((value - low) / span) * 74;
      return `${x},${y}`;
    });
    return { line: linePoints.join(" "), last: linePoints.at(-1) ?? "100,50" };
  }, [points]);

  const [lastX, lastY] = chart.last.split(",");
  return (
    <svg className="mini-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="BTC price movement over the last three minutes">
      <line x1="0" x2="100" y1="24" y2="24" className="chart-grid" />
      <line x1="0" x2="100" y1="57" y2="57" className="chart-grid" />
      <line x1="0" x2="100" y1="90" y2="90" className="chart-grid" />
      <polyline points={chart.line} className="chart-line" />
      <circle cx={lastX} cy={lastY} r="1.8" className="chart-dot" />
    </svg>
  );
}

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

const recentResults = [
  { market: "BTC", result: "Won", entry: "+0.50", time: "2m ago" },
  { market: "ETH", result: "Lost", entry: "−0.25", time: "8m ago" },
  { market: "BTC", result: "Won", entry: "+1.00", time: "14m ago" },
];

type ModeId = "quick-play" | "pulse" | "battle-24h";
type MarketId = "btc" | "eth" | "doge";

const MARKETS: Record<MarketId, { label: string; symbol: string; name: string }> = {
  btc: { label: "BTC", symbol: "₿", name: "BTC-USD" },
  eth: { label: "ETH", symbol: "Ξ", name: "ETH-USD" },
  doge: { label: "DOGE", symbol: "Ð", name: "DOGE-USD" },
};

// Games are only built out for BTC so far; ETH and DOGE get the same mode list
// with no href, which the panel below renders as "soon" and leaves inert.
const MODES_BY_MARKET: Record<MarketId, { id: ModeId; label: string; meta: string; href?: string; matched?: boolean }[]> = {
  btc: [
    { id: "quick-play", label: "Quick Play", meta: "BTC · head to head · online", matched: true },
    { id: "pulse", label: "Pulse", meta: "BTC · head to head · trade live", matched: true },
    { id: "battle-24h", label: "24h Reading", meta: "BTC · new call every 6h · leveraged", href: "/duel/btc/reading" },
  ],
  eth: [
    { id: "quick-play", label: "Quick Play", meta: "ETH · head to head · online" },
    { id: "pulse", label: "Pulse", meta: "ETH · solo · trade live for 60 seconds" },
    { id: "battle-24h", label: "24h Reading", meta: "ETH · new call every 6h · leveraged", href: "/duel/eth/reading" },
  ],
  doge: [
    { id: "quick-play", label: "Quick Play", meta: "DOGE · 60 seconds · head to head" },
    { id: "pulse", label: "Pulse", meta: "DOGE · solo · trade live for 60 seconds" },
    { id: "battle-24h", label: "24h Reading", meta: "DOGE · one call · settled in 24 hours" },
  ],
};

const SYMBOL_CLASS: Record<MarketId, string> = {
  btc: "btc-symbol",
  eth: "eth-symbol",
  doge: "doge-symbol",
};

export default function Page() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const [market, setMarket] = useState<MarketId>("btc");
  const dailyCoinId = pickDailyCoin().toLowerCase() as MarketId;
  const activeMarket = MARKETS[market];
  const { price, points, status } = usePriceFeed(activeMarket.name);
  const [wager, setWager] = useState("10");
  const [isCustomWager, setIsCustomWager] = useState(false);
  const [timer, setTimer] = useState(60);
  const [mode, setMode] = useState<ModeId>("quick-play");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [pending, setPending] = useState<string | null>(null); // "play" | match id
  const [matchError, setMatchError] = useState<string | null>(null);
  // Set while this browser is sitting in its own `open` match. The room is
  // only entered once an opponent takes the seat.
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queuedFor, setQueuedFor] = useState(0);
  // A live match elsewhere blocks queueing/joining another one here — the
  // global ActiveMatchBar is the only way back into it.
  const [activeMatch, setActiveMatchState] = useState<ActiveMatch | null>(null);
  const [inviteState, setInviteState] = useState<"idle" | "shared" | "copied" | "error">("idle");
  const modes = MODES_BY_MARKET[market];
  const currentPrice = price ?? points.at(-1)?.p ?? null;
  const firstPrice = points[0]?.p ?? currentPrice;
  const change = currentPrice !== null && firstPrice ? ((currentPrice - firstPrice) / firstPrice) * 100 : null;
  const activeMode = modes.find((option) => option.id === mode) ?? modes[0];
  const isPlayable = Boolean(activeMode.href || activeMode.matched);
  const takesCall = mode === "quick-play" || mode === "pulse";
  const matchMode = mode === "pulse" ? "pulse" : "quick-play";
  const playHref = activeMode.href ?? "/duel";
  const wagerValue = Math.floor(Number(wager));
  const wagerIsValid = Number.isFinite(wagerValue) && wagerValue > 0;
  const canPlay = matchMode === "pulse" || wagerIsValid;

  useEffect(() => setPlayerId(getPlayerId()), []);

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

  // Only poll the lobby list while a networked mode is on screen.
  useEffect(() => {
    if (!takesCall) return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const query = new URLSearchParams({ market, mode: matchMode });
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
  }, [market, takesCall, matchMode, playerId]);

  const matchHref = (matchMarket: string, matchId: string, matchMode = "quick-play") =>
    matchMode === "pulse"
      ? `/duel/${matchMarket}/pulse/${matchId}`
      : `/duel/${matchMarket}/match/${matchId}`;

  const inviteHref = queue
    ? `${matchHref(queue.market, queue.matchId, queue.mode)}?invite=1`
    : null;

  const practiceHref =
    mode === "pulse"
      ? market === "btc"
        ? "/duel/btc/pulse?practice=1"
        : null
      : `/duel/${market}/practice`;

  const shareInvite = async () => {
    if (!inviteHref || !queue) return;
    const url = `${window.location.origin}${inviteHref}`;
    setInviteState("idle");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join my Prophecy arena",
          text: `Tap to play a ${MARKETS[queue.market].label} ${queue.mode === "pulse" ? "Pulse" : "Quick Play"} arena against me.`,
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
    (matchMarket: string, matchId: string, matchMode = "quick-play") =>
      router.push(matchHref(matchMarket, matchId, matchMode)),
    [router],
  );

  // Pressing Play either takes a seat someone was holding — straight into the
  // room — or opens a match and waits here. Nobody enters a room alone.
  const play = async () => {
    if (!playerId || !isSignedIn || pending || queue || !canPlay || activeMatch) return;
    setPending("play");
    setMatchError(null);
    try {
      const res = await fetch("/api/match/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          market,
          mode: matchMode,
          // Pulse chooses its position stake in the room; this value only
          // keeps its lobby rows compatible with the shared match schema.
          wager: matchMode === "pulse" ? 100 : wagerValue,
          timerSeconds: timer,
        }),
      });
      if (!res.ok) throw new Error(res.status === 402 ? "insufficient" : "no match");
      const { matchId, status: matchStatus } = (await res.json()) as {
        matchId: string;
        status: string;
      };
      if (matchStatus === "open") {
        setQueue({ matchId, market, mode: matchMode, wager: matchMode === "pulse" ? 100 : wagerValue, timerSeconds: timer, since: Date.now() });
        setQueuedFor(0);
        setPending(null);
        return;
      }
      enterMatch(market, matchId, matchMode);
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

    // The 15s lock window starts the moment the opponent joins, so the room is
    // warmed here rather than paid for out of that budget.
    router.prefetch(matchHref(queue.market, queue.matchId, queue.mode));

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
            enterMatch(queue.market, queue.matchId, queue.mode);
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

  const join = async (match: OpenMatch) => {
    if (!playerId || !isSignedIn || pending || queue || activeMatch) return;
    setPending(match.id);
    setMatchError(null);
    try {
      const res = await fetch(`/api/match/${encodeURIComponent(match.id)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      if (!res.ok) throw new Error(res.status === 402 ? "insufficient" : "taken");
      enterMatch(match.market, match.id, match.mode);
    } catch (error) {
      setMatchError(error instanceof Error && error.message === "insufficient"
        ? "Not enough coins to join that match."
        : isSignedIn ? "That match was taken. Pick another, or press Play." : "Sign in to wager your balance.");
      setPending(null);
    }
  };

  return (
    <main className="lobby-shell" data-market={market}>
      <nav className="market-nav" aria-label="Market switcher">
        <div className="market-switcher">
          <span className="field-label">Markets</span>
          <button className={market === "btc" ? "active" : ""} type="button" onClick={() => setMarket("btc")}><span className="market-symbol btc-symbol">₿</span> BTC</button>
          <button className={market === "eth" ? "active" : ""} type="button" onClick={() => setMarket("eth")}><span className="market-symbol eth-symbol">Ξ</span> ETH</button>
        </div>
        <DailyCoin active={market === dailyCoinId} onSelect={() => setMarket(dailyCoinId)} />
      </nav>

      <section className="market-overview panel">
        <div className="ticker-copy">
          <div className="eyebrow-row">
            <span className="eyebrow">{activeMarket.label} / USD</span>
            <span className={`feed-status ${status === "live" ? "is-live" : ""}`}><span className="status-dot" /> {status === "live" ? "Live" : status}</span>
          </div>
          <div className="ticker-price display-font">{usd(currentPrice)}</div>
          <div className="ticker-change"><span className={change !== null && change >= 0 ? "change-up" : "change-down"}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span><span className="muted">3 min range</span></div>
        </div>
        <div className="ticker-chart-wrap"><MiniChart points={points} /><div className="chart-caption"><span>−3m</span><span>now</span></div></div>
        <dl className="market-stats">
          <div><dt>24h high</dt><dd>{currentPrice === null ? "—" : usd(currentPrice * 1.018)}</dd></div>
          <div><dt>24h low</dt><dd>{currentPrice === null ? "—" : usd(currentPrice * 0.982)}</dd></div>
          <div><dt>Players</dt><dd>2,486</dd></div>
        </dl>
      </section>

      <div className="section-heading">
        <div>
          <span className="eyebrow">Make a call</span>
          <h1 className="display-font">{activeMode.label}</h1>
          <span className="round-meta">{activeMode.meta}</span>
        </div>
        <div className="mode-switcher" role="group" aria-label="Choose a mode">
          {modes.map((option) => (
            <button key={option.id} type="button" className={option.id === mode ? "active" : ""} aria-pressed={option.id === mode} onClick={() => setMode(option.id)}>
              {option.label}
              {option.href || option.matched ? null : <small>soon</small>}
            </button>
          ))}
        </div>
      </div>

      {queue ? (
        <section className="queue-panel panel" aria-live="polite">
          <span className="queue-pulse" aria-hidden="true" />
          <div className="queue-copy">
            <span className="field-label">In queue</span>
            <strong>Waiting for an opponent…</strong>
            <span className="muted">
              {MARKETS[queue.market].label} {queue.mode === "pulse" ? "Pulse" : "Quick Play"} · {queue.timerSeconds}s round
            </span>
          </div>
          <span className="queue-elapsed">{queuedFor}s</span>
          <div className="queue-actions">
            <button type="button" className="queue-share" onClick={shareInvite}>
              {inviteState === "shared" ? "Shared" : inviteState === "copied" ? "Copied" : "Share invite"}
            </button>
            {inviteState === "error" && <span className="queue-share-error">Copy the link from your browser address bar.</span>}
          </div>
          <button type="button" className="queue-cancel" onClick={cancelQueue}>Cancel</button>
        </section>
      ) : mode === "battle-24h" && isPlayable ? (
        <Battle24h feedSymbol={activeMarket.name} />
      ) : (
      <section className="quick-play panel">
        <div className="quick-play-market"><span className={`market-symbol ${SYMBOL_CLASS[market]}`}>{activeMarket.symbol}</span><div><strong>{activeMarket.label} / USD</strong><span className="muted">{isPlayable ? "Current round" : "Not open yet"}</span></div></div>
        {mode === "pulse" ? (
          <div className="control-group">
            <span className="field-label">Pulse format</span>
            <strong className="muted">$100 bankroll</strong>
            <span className="muted">Stake + leverage in room</span>
          </div>
        ) : (
          <div className="control-group">
            <span className="field-label">Wager</span>
            <div className="segmented-control" role="group" aria-label="Choose wager">
              {WAGER_PRESETS.map((preset) => (
                <button key={preset} type="button" disabled={!takesCall} className={!isCustomWager && wager === String(preset) ? "is-selected" : ""} onClick={() => { setWager(String(preset)); setIsCustomWager(false); }}>{preset}</button>
              ))}
              <button type="button" disabled={!takesCall} className={isCustomWager ? "is-selected" : ""} onClick={() => setIsCustomWager(true)}>Custom</button>
            </div>
            {isCustomWager && <span className="entry-input-wrap"><input value={wager} onChange={(event) => setWager(event.target.value)} disabled={!takesCall} inputMode="decimal" aria-label="Custom wager amount" /><span>coins</span></span>}
          </div>
        )}
        <div className="control-group">
          <span className="field-label">Timer</span>
          <div className="segmented-control" role="group" aria-label="Choose round length">
            {TIMER_PRESETS.map((preset) => (
              <button key={preset.value} type="button" disabled={!takesCall} className={timer === preset.value ? "is-selected" : ""} onClick={() => setTimer(preset.value)}>{preset.label}</button>
            ))}
          </div>
        </div>
        <div className="opponent-status"><span className="field-label">Opponent</span><strong><span className={`status-dot ${isPlayable ? "is-online" : ""}`} /> {takesCall ? "Open lobby" : isPlayable ? "Solo · NOVA AI" : "Unavailable"}</strong><span className="muted">{takesCall ? `${openMatches.length} ${mode === "pulse" ? "Pulse match" : "match"}${openMatches.length === 1 ? "" : "es"} waiting` : isPlayable ? "Stake and leverage set in-round" : "Mode in development"}</span></div>
        <div className="play-actions">
          {activeMode.matched
            ? <button type="button" className="play-button" onClick={play} disabled={!playerId || !isSignedIn || pending !== null || queue !== null || !canPlay || activeMatch !== null}>{pending === "play" ? "Finding a match…" : isSignedIn ? <>Play <span aria-hidden="true">→</span></> : "Sign in to play"}</button>
            : isPlayable
              ? <Link href={playHref} className="play-button">Play <span aria-hidden="true">→</span></Link>
              : <button type="button" className="play-button" disabled>Soon</button>}
          {takesCall && practiceHref && (
            <Link href={practiceHref} className="practice-button">
              Practice
            </Link>
          )}
        </div>
        {activeMatch ? (
          <span className="muted">Finish your live arena before starting another.</span>
        ) : (
          matchError && <span className="muted">{matchError}</span>
        )}
      </section>
      )}

      <section className="lower-grid">
        <div><div className="list-heading"><h2>Open matches</h2><span className="muted">Live lobby</span></div><div className="data-list panel">
          {!takesCall && <div className="data-row"><span className="muted">Choose Quick Play or Pulse</span></div>}
          {takesCall && openMatches.length === 0 && <div className="data-row"><span className="muted">No one is waiting — press Play to open one.</span></div>}
          {takesCall && openMatches.map((match) => {
            const label = MARKETS[match.market as MarketId]?.label ?? match.market.toUpperCase();
            return (
              <button type="button" className="data-row" key={match.id} onClick={() => join(match)} disabled={pending !== null || queue !== null || match.isYours || activeMatch !== null}>
                <div className="row-market"><span className={`market-symbol ${match.market === "btc" ? "btc-symbol" : "eth-symbol"}`}>{match.market === "btc" ? "₿" : "Ξ"}</span><span><strong>{label}</strong><span className="muted">{match.timerSeconds}s · {match.isYours ? "yours" : match.mode === "pulse" ? "Pulse" : "Quick Play"}</span></span></div>
                <span className="row-detail">1 / 2</span>
                <span className="row-detail">{match.mode === "pulse" ? "live trade" : `${match.wager} coins`}</span>
                <span className="row-age">{pending === match.id ? "joining…" : age(match.createdAt)}</span>
              </button>
            );
          })}
        </div></div>
        <div><div className="list-heading"><h2>Recent results</h2><span className="muted">Today</span></div><div className="data-list panel">{recentResults.map((result, index) => <div className="data-row result-row" key={`${result.market}-${index}`}><div className="row-market"><span className={`market-symbol ${result.market === "BTC" ? "btc-symbol" : "eth-symbol"}`}>{result.market === "BTC" ? "₿" : "Ξ"}</span><strong>{result.market}</strong></div><span className={result.result === "Won" ? "change-up" : "change-down"}>{result.result}</span><span className="row-detail">{result.entry}</span><span className="row-age">{result.time}</span></div>)}</div></div>
      </section>

    </main>
  );
}
