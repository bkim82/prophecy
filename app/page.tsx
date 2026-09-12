"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePriceFeed } from "./usePriceFeed";

type Direction = "UP" | "DOWN";

const usd = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

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

const openMatches = [
  { market: "BTC", mode: "Quick Play", entry: "0.25", players: "1 / 2", age: "12s" },
  { market: "BTC", mode: "Quick Play", entry: "1.00", players: "1 / 2", age: "28s" },
  { market: "ETH", mode: "Quick Play", entry: "0.25", players: "1 / 2", age: "41s" },
];

const recentResults = [
  { market: "BTC", result: "Won", entry: "+0.50", time: "2m ago" },
  { market: "ETH", result: "Lost", entry: "−0.25", time: "8m ago" },
  { market: "BTC", result: "Won", entry: "+1.00", time: "14m ago" },
];

type ModeId = "quick-play" | "pulse" | "battle-24h";

const MODES: { id: ModeId; label: string; meta: string; href?: string }[] = [
  { id: "quick-play", label: "Quick Play", meta: "BTC · 60 seconds · head to head", href: "/duel/btc/quick-play" },
  { id: "pulse", label: "Pulse", meta: "BTC · solo · trade live for 60 seconds", href: "/duel/btc/pulse" },
  { id: "battle-24h", label: "24hr Battle", meta: "BTC · one call · settled in 24 hours" },
];

export default function Page() {
  const { price, points, status } = usePriceFeed();
  const [direction, setDirection] = useState<Direction>("UP");
  const [entry, setEntry] = useState("0.25");
  const [mode, setMode] = useState<ModeId>("quick-play");
  const currentPrice = price ?? points.at(-1)?.p ?? null;
  const firstPrice = points[0]?.p ?? currentPrice;
  const change = currentPrice !== null && firstPrice ? ((currentPrice - firstPrice) / firstPrice) * 100 : null;
  const activeMode = MODES.find((option) => option.id === mode) ?? MODES[0];
  const isPlayable = Boolean(activeMode.href);
  // Only Quick Play settles a single call; Pulse takes its stake and leverage
  // on its own page, so it gets a bare href and leaves these controls inert.
  const takesCall = mode === "quick-play";
  const playHref = takesCall
    ? `${activeMode.href}?direction=${direction.toLowerCase()}&entry=${entry}`
    : (activeMode.href as string);

  return (
    <main className="lobby-shell">
      <nav className="market-nav" aria-label="Market switcher">
        <div className="market-switcher">
          <span className="field-label">Markets</span>
          <button className="active" type="button"><span className="market-symbol btc-symbol">₿</span> BTC</button>
          <button type="button"><span className="market-symbol eth-symbol">Ξ</span> ETH <small>soon</small></button>
        </div>
      </nav>

      <section className="market-overview panel">
        <div className="ticker-copy">
          <div className="eyebrow-row">
            <span className="eyebrow">BTC / USD</span>
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
          <span className="field-label">Modes</span>
          {MODES.map((option) => (
            <button key={option.id} type="button" className={option.id === mode ? "active" : ""} aria-pressed={option.id === mode} onClick={() => setMode(option.id)}>
              {option.label}
              {option.href ? null : <small>soon</small>}
            </button>
          ))}
        </div>
      </div>

      <section className="quick-play panel">
        <div className="quick-play-market"><span className="market-symbol btc-symbol">₿</span><div><strong>BTC / USD</strong><span className="muted">{isPlayable ? "Current round" : "Not open yet"}</span></div></div>
        <div className="control-group"><span className="field-label">Direction</span><div className="segmented-control" role="group" aria-label="Choose direction">{(["UP", "DOWN"] as const).map((option) => <button key={option} type="button" disabled={!takesCall} className={direction === option ? "is-selected" : ""} onClick={() => setDirection(option)}>{option}</button>)}</div></div>
        <label className="control-group"><span className="field-label">Entry</span><span className="entry-input-wrap"><input value={entry} onChange={(event) => setEntry(event.target.value)} disabled={!takesCall} inputMode="decimal" aria-label="Entry amount" /><span>coins</span></span></label>
        <div className="control-group timer-control"><span className="field-label">Timer</span><strong className="timer-value display-font">{isPlayable ? "01:00" : "—"}</strong></div>
        <div className="opponent-status"><span className="field-label">Opponent</span><strong><span className={`status-dot ${isPlayable ? "is-online" : ""}`} /> {takesCall ? "Open lobby" : isPlayable ? "Solo · NOVA AI" : "Unavailable"}</strong><span className="muted">{takesCall ? "2,486 players online" : isPlayable ? "Stake and leverage set in-round" : "Mode in development"}</span></div>
        {isPlayable
          ? <Link href={playHref} className="play-button">Play <span aria-hidden="true">→</span></Link>
          : <button type="button" className="play-button" disabled>Soon</button>}
      </section>

      <section className="lower-grid">
        <div><div className="list-heading"><h2>Open matches</h2><span className="muted">Live lobby</span></div><div className="data-list panel">{openMatches.map((match, index) => <div className="data-row" key={`${match.market}-${match.entry}-${index}`}><div className="row-market"><span className={`market-symbol ${match.market === "BTC" ? "btc-symbol" : "eth-symbol"}`}>{match.market === "BTC" ? "₿" : "Ξ"}</span><span><strong>{match.market}</strong><span className="muted">{match.mode}</span></span></div><span className="row-detail">{match.players}</span><span className="row-detail">{match.entry} coins</span><span className="row-age">{match.age}</span></div>)}</div></div>
        <div><div className="list-heading"><h2>Recent results</h2><span className="muted">Today</span></div><div className="data-list panel">{recentResults.map((result, index) => <div className="data-row result-row" key={`${result.market}-${index}`}><div className="row-market"><span className={`market-symbol ${result.market === "BTC" ? "btc-symbol" : "eth-symbol"}`}>{result.market === "BTC" ? "₿" : "Ξ"}</span><strong>{result.market}</strong></div><span className={result.result === "Won" ? "change-up" : "change-down"}>{result.result}</span><span className="row-detail">{result.entry}</span><span className="row-age">{result.time}</span></div>)}</div></div>
      </section>

    </main>
  );
}
