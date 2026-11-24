"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PulseMatchChart, { type MatchChartMarker } from "./PulseMatchChart";
import PulseMovementAlert from "./PulseMovementAlert";
import type { PricePoint } from "./usePriceFeed";

/**
 * The in-match Pulse screen, shared by solo/practice vs Sibyl
 * (app/duel/btc/pulse/page.tsx) and the multiplayer room
 * (app/duel/[market]/pulse/[matchId]/page.tsx). Pure presentation: each page
 * owns its game state and hands this the numbers. One slim top bar, the
 * scoreboard as the hero (timer ring centre, balances either side, your signed
 * lead, purple-vs-amber tug-of-war), Sibyl's speech bubble, the chart (app/PulseMatchChart.tsx),
 * then the controls — or, once settled, the full-screen result. Styles:
 * `.pm-*` in app/globals.css ("Pulse match screen").
 */

export type MatchSide = "long" | "short";
export type MatchChartMarkerInput = MatchChartMarker;
type FeedbackKind = "entry" | "exit" | "reverse" | "win" | "tick";

// A lead under this is a coin flip for events (shake, Sibyl's mood, the
// aria-live call); the line and card tint use cents.
const FLIP_THRESHOLD = 0.5;
const EVEN_THRESHOLD = 0.005;
// Within this share of the entry→liquidation distance, liquidation is "near".
const LIQ_NEAR_SHARE = 0.25;

export const matchUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$0.00" at zero; otherwise signed with a real minus. */
export const matchSignedUsd = (n: number) =>
  Math.abs(n) < EVEN_THRESHOLD ? matchUsd(0) : `${n > 0 ? "+" : "−"}${matchUsd(Math.abs(n))}`;

/** "$100" for whole dollars, "$12.50" otherwise — the Amount chip. */
export const compactUsd = (n: number) =>
  Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : matchUsd(n);

const priceText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const liquidationPrice = (side: MatchSide, entry: number, leverage: number) =>
  side === "long" ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);

/** "1", "0.1", "0.01" — how far price moves to wipe the stake at this leverage. */
const liqPercent = (leverage: number) => `${Number((100 / leverage).toPrecision(2))}`;

const sideWord = (side: MatchSide) => (side === "long" ? "Long" : "Short");

/** Per-coin identity: full name and glyph (top-bar pill, chart header + watermark). Colours come from [data-market] in app/globals.css. */
const MARKET_IDENTITY: Record<string, { name: string; glyph: string }> = {
  btc: { name: "Bitcoin", glyph: "₿" },
  eth: { name: "Ethereum", glyph: "Ξ" },
  nvda: { name: "Nvidia", glyph: "N" },
  doge: { name: "Dogecoin", glyph: "Ð" },
  hype: { name: "Hyperliquid", glyph: "H" },
};

/** Win streak per browser, keyed by mode; counted once per round id. */
export function useWinStreak(storageKey: string, result: { id: string; won: boolean } | null) {
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { count?: number } | null;
      setStreak(raw?.count ?? 0);
    } catch {
      // Storage blocked: the badge just stays hidden.
    }
  }, [storageKey]);
  const id = result?.id ?? null;
  const won = result?.won ?? false;
  useEffect(() => {
    if (id === null) return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { count?: number; lastId?: string } | null;
      if (raw?.lastId === id) return setStreak(raw.count ?? 0);
      const count = won ? (raw?.count ?? 0) + 1 : 0;
      window.localStorage.setItem(storageKey, JSON.stringify({ count, lastId: id }));
      setStreak(count);
    } catch {
      setStreak((count) => (won ? count + 1 : 0));
    }
  }, [storageKey, id, won]);
  return streak;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Each digit is a 0–9 strip that rolls to its value; keyed from the right so units stay put. */
function RollingNumber({ text }: { text: string }) {
  const chars = text.split("");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="pm-roll" aria-hidden="true">
        {chars.map((ch, i) => {
          const key = chars.length - i;
          if (ch >= "0" && ch <= "9") {
            return (
              <span key={`d${key}`} className="pm-roll-digit">
                <span className="pm-roll-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
                  {DIGITS.map((d) => <span key={d}>{d}</span>)}
                </span>
              </span>
            );
          }
          return <span key={`c${key}${ch}`}>{ch}</span>;
        })}
      </span>
    </>
  );
}

export function FlameGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.17)} viewBox="0 0 12 14" aria-hidden="true">
      <path d="M6 0C6 4 1 5 1 9a5 5 0 0 0 10 0C11 5 6 4 6 0z" fill="#F5A55A" />
    </svg>
  );
}

type Mood = "neutral" | "smug" | "frown";

/** Sibyl's face: neutral before entry, smug when she leads, a frown when she trails. */
function SibylFace({ mood, size = 22 }: { mood: Mood; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {mood === "smug" ? (
        <>
          <path d="M6.5 10h3.5M14 10h3.5" />
          <path d="M8 15.2c3 2.2 6 1.8 8.6-1.6" />
        </>
      ) : (
        <>
          <circle cx="8.5" cy="10" r="1" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1" fill="currentColor" />
          <path d={mood === "frown" ? "M8 17c2.5-2.5 5.5-2.5 8 0" : "M8 15.5h8"} />
        </>
      )}
    </svg>
  );
}

type Tone = "lead" | "trail" | "even";

function Avatar({ who, tone, mood, initial, size = 40 }: { who: "you" | "sibyl" | "player"; tone: Tone; mood?: Mood; initial?: string; size?: number }) {
  return (
    <span className={`pm-avatar is-${who} is-${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      {who === "you" ? "Y" : who === "sibyl" ? <SibylFace mood={mood ?? "neutral"} size={Math.round(size * 0.55)} /> : initial ?? "?"}
    </span>
  );
}

/** Sized by --pm-ring in CSS; the number scales with it. */
function TimerRing({ seconds, total, urgent, caption }: { seconds: number; total: number; urgent: boolean; caption: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? clamp(seconds / total, 0, 1) : 0;
  const shown = Math.max(0, seconds);
  return (
    <div className={`pm-timer${urgent ? " is-urgent" : ""}`} role="timer" aria-label={`${caption}: ${seconds} seconds`}>
      {/* Re-keyed each second while urgent, so the heartbeat lands on the tick. */}
      <div key={urgent ? seconds : "calm"} className="pm-timer-beat">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="pm-timer-track" cx="50" cy="50" r={r} strokeWidth="8" />
          <circle
            className="pm-timer-fill"
            cx="50"
            cy="50"
            r={r}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="pm-timer-text">
          {/* Re-keyed so each second drops in. */}
          <span key={shown} className="pm-num pm-timer-sec">{shown}</span>
          <span>{caption}</span>
        </div>
      </div>
    </div>
  );
}

/** Amount / Leverage chip that opens a small menu upward (the controls sit at the bottom). */
function MatchSelect({
  label, value, tone, disabled, menuLabel, children,
}: {
  label: string;
  value: string;
  tone?: "risk";
  disabled: boolean;
  menuLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <div ref={ref} className="pm-select">
      <button
        type="button"
        className={`pm-select-btn${tone ? ` is-${tone}` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pm-select-label">{label}</span>
        <span className="pm-select-value pm-num">{value}</span>
      </button>
      {open && (
        <div className="pm-menu" role="group" aria-label={menuLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One option row inside a MatchSelect menu. */
export function MatchMenuOption({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`pm-menu-option pm-num${selected ? " is-selected" : ""}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export type MatchPosition = {
  side: MatchSide;
  entryPrice: number;
  leverage: number;
  /** Local ms it opened (the chart's entry line starts here). */
  openedAt: number;
  /** Live P&L of this position. */
  pnl: number;
  /** Already worth −stake; the close is pending. */
  liquidated: boolean;
};

export type MatchControls = {
  /** waiting: no round yet (lobby / pre-round); settling: the bell rang. */
  state: "setup" | "open" | "settling" | "waiting";
  amountLabel: string;
  amountMenu: (close: () => void) => ReactNode;
  leverage: number;
  leverageOptions: readonly number[];
  onLeverage: (leverage: number) => void;
  canEdit: boolean;
  canEnter: boolean;
  onEnter: (side: MatchSide) => void;
  /** Replaces the "Enters at the live price…" helper (waiting, busted, no feed). */
  hint: string | null;
  canManage: boolean;
  onClose: () => void;
  onFlip: () => void;
  /** Positions stacked from the mini dock beyond the one shown. */
  extraOpen?: number;
  notice?: string | null;
  error?: string | null;
  footer?: ReactNode;
};

function Controls({ controls, position, price }: { controls: MatchControls; position: MatchPosition | null; price: number | null }) {
  const [pressed, setPressed] = useState<MatchSide | null>(null);
  const press = (side: MatchSide) => {
    setPressed(side);
    controls.onEnter(side);
    window.setTimeout(() => setPressed(null), 160);
  };
  const messages = (
    <>
      {controls.notice && <p className="pm-controls-notice" role="status">{controls.notice}</p>}
      {controls.error && <p className="pm-controls-notice" role="alert">{controls.error}</p>}
      {controls.footer}
    </>
  );

  if (controls.state === "settling") {
    return (
      <section className="pm-controls is-settling" aria-label="Round ending">
        <p className="pm-settling">Time! Locking the final price…</p>
        {messages}
      </section>
    );
  }

  if (controls.state === "open" && position) {
    const up = position.pnl >= 0;
    const liq = liquidationPrice(position.side, position.entryPrice, position.leverage);
    const near = price !== null && isNearLiq(position, price);
    return (
      <section className="pm-controls is-open" aria-label="Your position">
        {controls.extraOpen ? (
          <p className="pm-controls-note">+{controls.extraOpen} more open — Close acts on the newest</p>
        ) : null}
        <button
          type="button"
          className={`pm-close ${up ? "is-up" : "is-down"}`}
          disabled={!controls.canManage || position.liquidated}
          onClick={controls.onClose}
        >
          <span className="pm-close-copy">
            <span className="pm-close-title">{position.liquidated ? "Liquidated" : "Close & lock it"}</span>
            <span className="pm-close-sub">
              {sideWord(position.side)} {position.leverage}× · entry <span className="pm-num">{priceText(position.entryPrice)}</span>
            </span>
          </span>
          <span className="pm-close-pnl pm-num">{matchSignedUsd(position.pnl)}</span>
        </button>
        <div className="pm-controls-row">
          <button
            type="button"
            className={`pm-flip is-${position.side === "long" ? "short" : "long"}`}
            disabled={!controls.canManage || position.liquidated}
            onClick={controls.onFlip}
          >
            Flip to {position.side === "long" ? "Short" : "Long"}
          </button>
          <div className={`pm-liq${near || position.liquidated ? " is-near" : ""}`} role="status">
            Liq <span className="pm-num">{priceText(liq)}</span> · {position.liquidated ? "hit" : near ? "close!" : "safe"}
          </div>
        </div>
        {messages}
      </section>
    );
  }

  return (
    <section className="pm-controls is-setup" aria-label="Place a trade">
      <div className="pm-controls-row is-picks">
        <MatchSelect label="Amount" value={controls.amountLabel} disabled={!controls.canEdit} menuLabel="Amount">
          {controls.amountMenu}
        </MatchSelect>
        <MatchSelect label="Leverage" value={`${controls.leverage}×`} tone="risk" disabled={!controls.canEdit} menuLabel="Leverage">
          {(close) => controls.leverageOptions.map((option) => (
            <MatchMenuOption
              key={option}
              selected={controls.leverage === option}
              onClick={() => {
                controls.onLeverage(option);
                close();
              }}
            >
              {option}× <small>liq ±{liqPercent(option)}%</small>
            </MatchMenuOption>
          ))}
        </MatchSelect>
      </div>
      <div className="pm-controls-row is-sides">
        {(["long", "short"] as const).map((side) => (
          <button
            key={side}
            type="button"
            disabled={!controls.canEnter}
            onPointerDown={(event) => {
              if (event.button === 0) press(side);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                press(side);
              }
            }}
            className={`pm-trade is-${side}${pressed === side ? " is-pressed" : ""}`}
          >
            <span className="pm-trade-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={side === "long" ? "M7 17L17 7M9 7h8v8" : "M7 7l10 10M17 9v8H9"} />
              </svg>
              {sideWord(side)}
            </span>
            <span className="pm-trade-sub">price goes {side === "long" ? "up" : "down"}</span>
          </button>
        ))}
      </div>
      {/* is-default: the generic helper, hidden on phones; a real hint (waiting, busted, no feed) always shows. */}
      <p className={`pm-helper${controls.hint ? "" : " is-default"}`}>{controls.hint ?? `Enters at the live price · liquidation at ±${liqPercent(controls.leverage)}%`}</p>
      {messages}
    </section>
  );
}

function isNearLiq(position: MatchPosition, price: number) {
  const liq = liquidationPrice(position.side, position.entryPrice, position.leverage);
  const distance = Math.abs(position.entryPrice - liq);
  const losing = position.side === "long" ? price < position.entryPrice : price > position.entryPrice;
  return losing && Math.abs(price - liq) <= distance * LIQ_NEAR_SHARE;
}

function useCountUp(target: number, reduced: boolean, ms = 1100) {
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) return setValue(target);
    let frame = 0;
    const start = performance.now();
    const step = (time: number) => {
      const k = clamp((time - start) / ms, 0, 1);
      setValue(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, ms]);
  return value;
}

/** "134.70→.77" when the whole-number part matches, else both in full. */
const entryExitText = (entry: number, exit: number) => {
  const a = priceText(entry);
  const b = priceText(exit);
  const [aInt] = a.split(".");
  const [bInt, bDec] = b.split(".");
  return aInt === bInt ? `${a}→.${bDec}` : `${a}→${b}`;
};

const heldText = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 100 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export type MatchResult = {
  outcome: "win" | "loss" | "tie";
  /** The big number: payout on a win (orange), your final P&L otherwise. */
  hero: { value: number; format: (n: number) => string; icon?: ReactNode };
  /** Under the hero: "practice payout · beat Sibyl by $7.40". */
  caption: ReactNode;
  /** What decided it, shown on a loss. */
  story: string | null;
  you: { side: MatchSide | null; leverage: number | null; pnl: number };
  rival: { side: MatchSide | null; leverage: number | null; pnl: number };
  lastTrade: { entry: number; exit: number } | null;
  taunt: string | null;
  rematch: ReactNode;
  /** Win only: what Share posts. */
  shareText: string | null;
  /** Practice only: where real matches start. */
  playForRealHref?: string;
  extra?: ReactNode;
};

type Stats = { bestTick: number | null; holdMs: number };

function ResultView({
  result, stats, streak, rivalName, rivalKind, rivalInitial, backHref,
}: {
  result: MatchResult;
  stats: Stats;
  streak: number;
  rivalName: string;
  rivalKind: "sibyl" | "player";
  rivalInitial: string;
  backHref: string;
}) {
  const reduced = usePrefersReducedMotion();
  const shown = useCountUp(result.hero.value, reduced);
  const [shared, setShared] = useState<"idle" | "copied" | "failed">("idle");
  const win = result.outcome === "win";
  const loss = result.outcome === "loss";
  const confetti = useMemo(() => {
    if (!win) return [];
    const colors = ["#F5B26B", "#9B7BF7", "#4BEA97", "#FF8A95", "#FFF3DF", "#8EA2F5"];
    return Array.from({ length: 36 }, (_, i) => {
      const w = 5 + Math.round(Math.random() * 5);
      return {
        id: i,
        style: {
          left: `${Math.round(Math.random() * 100)}%`,
          top: `${Math.round(Math.random() * 40) - 8}%`,
          width: w,
          height: Math.random() > 0.5 ? w : w * 2,
          borderRadius: Math.random() > 0.7 ? "50%" : 2,
          background: colors[i % colors.length],
          animationDelay: `-${(Math.random() * 3.2).toFixed(2)}s`,
          animationDuration: `${(2.6 + Math.random() * 1.6).toFixed(2)}s`,
        },
      };
    });
  }, [win]);

  const share = async () => {
    if (!result.shareText) return;
    const url = `${window.location.origin}/duel`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text: result.shareText, url });
        return;
      }
      await navigator.clipboard.writeText(`${result.shareText} ${url}`);
      setShared("copied");
    } catch (reason) {
      // Dismissing the share sheet isn't a failure.
      if (reason instanceof Error && reason.name === "AbortError") return;
      setShared("failed");
    }
  };

  const stamp = win ? "YOU WIN" : loss ? `${rivalName.toUpperCase()} WINS` : "DRAW";
  const heroTone = win ? "is-win" : loss ? "is-loss" : "is-tie";
  const youTone = win ? "lead" : loss ? "trail" : "even";
  const rivalTone = loss ? "lead" : win ? "trail" : "even";
  const row = (name: string, avatar: ReactNode, info: MatchResult["you"]) => (
    <div className="pm-result-row">
      {avatar}
      <span className="pm-result-name">
        {name}
        <span>{info.side ? ` · ${sideWord(info.side)}${info.leverage ? ` ${info.leverage}×` : ""}` : " · no trade"}</span>
      </span>
      <span className={`pm-num pm-result-pnl ${info.pnl > EVEN_THRESHOLD ? "is-up" : info.pnl < -EVEN_THRESHOLD ? "is-down" : ""}`}>
        {matchSignedUsd(info.pnl)}
      </span>
    </div>
  );

  return (
    <section className={`pm-result is-${result.outcome}`} aria-label="Match result">
      {win && (
        <div className="pm-result-fx" aria-hidden="true">
          <svg className="pm-rays" width="560" height="560" viewBox="-280 -280 560 560">
            <g fill="#F5B26B">
              {Array.from({ length: 12 }, (_, i) => (
                <path key={i} d="M0 0 L-18 -280 L18 -280 Z" transform={`rotate(${i * 30})`} />
              ))}
            </g>
          </svg>
          {confetti.map((piece) => <span key={piece.id} className="pm-confetti" style={piece.style} />)}
        </div>
      )}

      <div className="pm-result-hero">
        {win ? (
          <svg width="64" height="56" viewBox="0 0 64 56" aria-hidden="true">
            <path d="M6 46 L2 12 L18 26 L32 4 L46 26 L62 12 L58 46 Z" fill="#F5B26B" stroke="#FFE0B0" strokeWidth="2" strokeLinejoin="round" />
            <rect x="6" y="48" width="52" height="6" rx="3" fill="#F5A55A" />
            <circle cx="32" cy="30" r="5" fill="#FFF3DF" />
          </svg>
        ) : (
          <Avatar
            who={loss ? (rivalKind === "sibyl" ? "sibyl" : "player") : "you"}
            tone={loss ? "lead" : "even"}
            mood={loss ? "smug" : "neutral"}
            initial={rivalInitial}
            size={56}
          />
        )}
        <h1 className="pm-stamp">{stamp}</h1>
        <p
          className={`pm-result-amount pm-num ${heroTone}`}
          // 72px, shrunk so the final figure (plus icon) fits the column.
          style={{ fontSize: `min(72px, calc((min(100vw, 560px) - 48px) / ${(result.hero.format(result.hero.value).length + (result.hero.icon ? 1 : 0)) * 0.62}))` }}
        >
          {result.hero.icon}
          {result.hero.format(shown)}
        </p>
        <p className="pm-result-caption">{result.caption}</p>
        {streak >= 2 && (
          <p className="pm-result-streak">
            <FlameGlyph size={14} /> {streak} wins in a row
          </p>
        )}
        {loss && result.story && <p className="pm-result-story">{result.story}</p>}
      </div>

      <div className="pm-result-card">
        {row("You", <Avatar who="you" tone={youTone} size={34} />, result.you)}
        {row(
          rivalName,
          <Avatar who={rivalKind === "sibyl" ? "sibyl" : "player"} tone={rivalTone} mood={loss ? "smug" : win ? "frown" : "neutral"} initial={rivalInitial} size={34} />,
          result.rival,
        )}
        <div className="pm-result-stats">
          <div>
            <span>Best tick</span>
            <strong className={`pm-num${stats.bestTick ? " is-up" : ""}`}>{stats.bestTick ? matchSignedUsd(stats.bestTick) : "—"}</strong>
          </div>
          <div>
            <span>Held</span>
            <strong className="pm-num">{heldText(stats.holdMs)}</strong>
          </div>
          <div>
            <span>Entry → exit</span>
            <strong className="pm-num is-small">{result.lastTrade ? entryExitText(result.lastTrade.entry, result.lastTrade.exit) : "—"}</strong>
          </div>
        </div>
      </div>

      {result.taunt && (
        <div className="pm-bubble-row">
          <p className={`pm-bubble${rivalKind === "sibyl" ? " is-sibyl" : ""}`}>
            {rivalKind === "sibyl" && <strong>Sibyl:</strong>} {result.taunt}
          </p>
        </div>
      )}

      {result.extra}

      <div className="pm-result-actions">
        {result.rematch}
        <div className="pm-controls-row">
          {win && result.shareText ? (
            <button type="button" className="pm-secondary is-share" onClick={() => void share()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
              </svg>
              {shared === "copied" ? "Link copied" : shared === "failed" ? "Couldn't share" : "Share win"}
            </button>
          ) : null}
          {result.playForRealHref ? (
            <Link href={result.playForRealHref} className="pm-secondary">Play for real</Link>
          ) : (
            <Link href={backHref} className="pm-secondary">Back to lobby</Link>
          )}
        </div>
      </div>
    </section>
  );
}

export type MatchScreenProps = {
  /** Changes per round; resets the lead scale and the round stats. */
  roundKey: string | number;
  market: string;
  marketLabel: string;
  /** "PRACTICE · PULSE" etc. */
  modeTag: ReactNode;
  feedLive: boolean;
  streak: number;
  sound: { muted: boolean; toggle: () => void; play: (kind: FeedbackKind) => void };
  backHref: string;
  /** Total the 5% movement alert watches (app/PulseMovementAlert.tsx). */
  alertTotal: number;
  /** Before the first entry of the round: neutral face, "make your call". */
  roundStarted: boolean;
  you: { equity: number; pnl: number; position: MatchPosition | null };
  rival: {
    name: string;
    kind: "sibyl" | "player";
    initial: string;
    equity: number;
    pnl: number;
    /** null hides it: Sibyl before her entry, a human opponent until settle. */
    side: MatchSide | null;
  };
  timer: { seconds: number; total: number; caption: string; /** Counting down a live round (final-10s effects). */ live: boolean };
  bubble: { speaker: string | null; text: string; key: number } | null;
  chart: { points: PricePoint[]; now: number; frozen: boolean; price: number | null; markers: MatchChartMarker[] };
  controls: MatchControls;
  result: MatchResult | null;
};

export default function MatchScreen(props: MatchScreenProps) {
  const { roundKey, market, marketLabel, modeTag, feedLive, streak, sound, backHref, alertTotal, roundStarted, you, rival, timer, bubble, chart, controls, result } = props;
  const position = you.position;
  const inPosition = position !== null;
  const leadDelta = you.pnl - rival.pnl;

  // Largest lead this round scales the tug-of-war.
  const maxLeadRef = useRef({ key: roundKey, value: 1 });
  if (maxLeadRef.current.key !== roundKey) maxLeadRef.current = { key: roundKey, value: 1 };
  maxLeadRef.current.value = Math.max(maxLeadRef.current.value, Math.abs(leadDelta));
  const share = clamp(50 + (leadDelta / maxLeadRef.current.value) * 50, 4, 96);

  const leadSide: "you" | "rival" | "tie" = leadDelta > FLIP_THRESHOLD ? "you" : leadDelta < -FLIP_THRESHOLD ? "rival" : "tie";
  const display: "you" | "rival" | "even" = leadDelta >= EVEN_THRESHOLD ? "you" : leadDelta <= -EVEN_THRESHOLD ? "rival" : "even";
  const youTone: Tone = display === "you" ? "lead" : display === "rival" ? "trail" : "even";
  const rivalTone: Tone = display === "rival" ? "lead" : display === "you" ? "trail" : "even";
  const mood: Mood = !roundStarted || leadSide === "tie" ? "neutral" : leadSide === "rival" ? "smug" : "frown";

  const final10 = timer.live && timer.seconds > 0 && timer.seconds <= 10 && !result;
  const nearLiq = position !== null && chart.price !== null && !result && (position.liquidated || isNearLiq(position, chart.price));
  const [shaking, setShaking] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Lead flips: a quick shake and a screen-reader call.
  const prevLeadRef = useRef(leadSide);
  useEffect(() => {
    const prev = prevLeadRef.current;
    prevLeadRef.current = leadSide;
    if (prev === leadSide || leadSide === "tie" || !roundStarted || result) return;
    setShaking(true);
    const id = window.setTimeout(() => setShaking(false), 450);
    setAnnouncement(leadSide === "you" ? `You took the lead from ${rival.name}.` : `${rival.name} took the lead.`);
    return () => window.clearTimeout(id);
    // Once per flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadSide]);

  // Heartbeat tick once per second through the final 10.
  useEffect(() => {
    if (final10) sound.play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final10 ? timer.seconds : null]);

  // Round stats for the result card: best single tick while holding, time held.
  const statsRef = useRef({ key: roundKey, best: null as number | null, prevPnl: null as number | null, holdMs: 0, heldSince: null as number | null });
  if (statsRef.current.key !== roundKey) statsRef.current = { key: roundKey, best: null, prevPnl: null, holdMs: 0, heldSince: null };
  useEffect(() => {
    const stats = statsRef.current;
    if (inPosition && stats.heldSince === null) stats.heldSince = Date.now();
    if (!inPosition && stats.heldSince !== null) {
      stats.holdMs += Date.now() - stats.heldSince;
      stats.heldSince = null;
    }
  }, [inPosition]);
  useEffect(() => {
    const stats = statsRef.current;
    if (!inPosition || result) {
      stats.prevPnl = null;
      return;
    }
    if (stats.prevPnl !== null) {
      const delta = you.pnl - stats.prevPnl;
      if (delta > 0 && (stats.best === null || delta > stats.best)) stats.best = delta;
    }
    stats.prevPnl = you.pnl;
  }, [you.pnl, inPosition, result]);

  const [finalStats, setFinalStats] = useState<Stats>({ bestTick: null, holdMs: 0 });
  const outcome = result?.outcome ?? null;
  useEffect(() => {
    if (!outcome) return;
    const stats = statsRef.current;
    setFinalStats({ bestTick: stats.best, holdMs: stats.holdMs + (stats.heldSince !== null ? Date.now() - stats.heldSince : 0) });
    if (outcome === "win") sound.play("win");
    const gap = matchUsd(Math.abs(leadDelta));
    setAnnouncement(outcome === "win" ? `You win. You beat ${rival.name} by ${gap}.` : outcome === "loss" ? `${rival.name} wins by ${gap}.` : "Draw. Dead even at the bell.");
    // Once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  // The scoreboard's one signed number: your P&L minus the rival's.
  const leadText =
    display === "even"
      ? inPosition ? "Dead even" : "Dead even — make your call"
      : (
        <>
          <span className="pm-lead-amount pm-num"><RollingNumber text={matchSignedUsd(leadDelta)} /></span>
          <span className="pm-lead-word">
            {display === "you" ? "ahead" : "behind"}
            <span className="sr-only">{display === "you" ? ` of ${rival.name}` : ` ${rival.name}`}</span>
          </span>
        </>
      );
  const youLabel = position ? `YOU · ${position.side.toUpperCase()}` : "YOU";
  const rivalLabel = `${rival.name.toUpperCase()}${rival.side ? ` · ${rival.side.toUpperCase()}` : rival.kind === "sibyl" ? " · AI" : ""}`;
  const bubbleTone = rival.kind !== "sibyl" ? "" : mood === "frown" ? "is-hurt" : "is-sibyl";
  const identity = MARKET_IDENTITY[market] ?? null;

  return (
    <main
      className={`pm-screen${final10 ? " is-final" : ""}${result ? " is-result" : ""}`}
      data-market={market}
    >
      <PulseMovementAlert total={alertTotal} />
      {(final10 || nearLiq) && <div className="pm-edge" aria-hidden="true" />}

      <header className="pm-top">
        <Link href={backHref} className="pm-icon-btn pm-back" aria-label="Back to arena">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <span className="pm-market">
          <span className={`pm-live-dot${feedLive ? " is-live" : ""}`} aria-hidden="true" />
          {identity && <span className="pm-market-glyph" aria-hidden="true">{identity.glyph}</span>}
          {marketLabel}
          {identity && <span className="pm-market-name">{identity.name}</span>}
          <span className="sr-only">{feedLive ? " live" : " connecting"}</span>
        </span>
        <span className="pm-tag">{modeTag}</span>
        <span className="pm-top-end">
          {streak > 0 && (
            <span className="pm-streak" aria-label={`${streak} win streak`}>
              <FlameGlyph /> <span className="pm-num" aria-hidden="true">{streak}</span>
            </span>
          )}
          <button type="button" className="pm-icon-btn" aria-label={sound.muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!sound.muted} onClick={sound.toggle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              {sound.muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
            </svg>
          </button>
        </span>
      </header>

      {result ? (
        <ResultView
          result={result}
          stats={finalStats}
          streak={streak}
          rivalName={rival.name}
          rivalKind={rival.kind}
          rivalInitial={rival.initial}
          backHref={backHref}
        />
      ) : (
        <>
          {/* Phones: display: contents (plain column items). Desktop: the right column's top block. */}
          <div className="pm-side">
            <section className={`pm-score is-${display}`} aria-label="Scoreboard">
              <div className="pm-score-row">
                <div className="pm-player">
                  <Avatar who="you" tone={youTone} size={34} />
                  <div className="min-w-0">
                    <div className={`pm-player-label${position ? ` is-${position.side}` : ""}`}>{youLabel}</div>
                    <div className="pm-player-bal pm-num">{matchUsd(Math.max(0, you.equity))}</div>
                  </div>
                </div>
                <TimerRing seconds={timer.seconds} total={timer.total} urgent={final10} caption={timer.caption} />
                <div className="pm-player is-rival">
                  <Avatar who={rival.kind === "sibyl" ? "sibyl" : "player"} tone={rivalTone} mood={mood} initial={rival.initial} size={34} />
                  <div className="min-w-0">
                    <div className={`pm-player-label${rival.side ? ` is-${rival.side}` : ""}`}>{rivalLabel}</div>
                    <div className="pm-player-bal pm-num">{matchUsd(Math.max(0, rival.equity))}</div>
                  </div>
                </div>
              </div>
              <p className={`pm-lead is-${display}`}>{leadText}</p>
              <div className={`pm-tug${shaking ? " is-shaking" : ""}`} aria-hidden="true">
                <div className="pm-tug-track">
                  <span className="pm-tug-you" style={{ width: `${share}%` }} />
                  <span className="pm-tug-rival" />
                </div>
                <span className={`pm-tug-spark is-${display}`} style={{ left: `${share}%` }} />
              </div>
            </section>

            {bubble && (
              <div className="pm-bubble-row">
                <p key={bubble.key} className={`pm-bubble ${bubbleTone}`}>
                  {bubble.speaker && <strong>{bubble.speaker}:</strong>} {bubble.text}
                </p>
              </div>
            )}
          </div>

          <section className="pm-chart" aria-label={`${marketLabel} live chart`}>
            <PulseMatchChart
              points={chart.points}
              now={chart.now}
              frozen={chart.frozen}
              marketLabel={marketLabel}
              price={chart.price}
              entry={position ? { t: position.openedAt, p: position.entryPrice, side: position.side } : null}
              positionPnl={position?.pnl ?? 0}
              liq={position ? { price: liquidationPrice(position.side, position.entryPrice, position.leverage), near: nearLiq } : null}
              markers={chart.markers}
              pnlThreshold={0.1}
              marketName={identity?.name}
              glyph={identity?.glyph}
            />
          </section>

          <Controls controls={controls} position={position} price={chart.price} />
        </>
      )}

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </main>
  );
}

/** Purple 3D Rematch for a page that handles the click itself. */
export function RematchAction({ onClick, label = "Rematch" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="pm-rematch" onClick={onClick}>
      <RematchIcon />
      {label}
    </button>
  );
}

export function RematchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" />
    </svg>
  );
}

/** For links/buttons from elsewhere (Rematch.tsx's RematchButton) that should look like RematchAction. */
export const PM_REMATCH_CLASS = "pm-rematch";
