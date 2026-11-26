"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clampPulseStake, pulseMaxStake, PULSE_STAKE_STEP } from "@/lib/pulse";
import PulseMatchChart, { type MatchChartMarker } from "./PulseMatchChart";
import PulseMovementAlert from "./PulseMovementAlert";
import type { PricePoint } from "./usePriceFeed";

/**
 * The in-match Pulse screen, shared by solo/practice vs Sibyl
 * (app/duel/btc/pulse/page.tsx) and the multiplayer room
 * (app/duel/[market]/pulse/[matchId]/page.tsx). Pure presentation: each page
 * owns its game state and hands this the numbers. One slim top bar, the
 * scoreboard as the hero (you | seconds-left countdown over your signed lead |
 * the rival, each with a big balance and a status line — Sibyl's is whatever
 * she last said — then the split purple-vs-amber tug-of-war), the room's
 * event bubble (multiplayer), the chart (app/PulseMatchChart.tsx), then the
 * controls — or, once settled, the full-screen result. Styles:
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

const priceText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Hands a balance's width in em (mono: .6em a glyph) to CSS, so a long one shrinks to fit a phone column. */
const balStyle = (text: string) => ({ "--pm-bal-em": text.length * 0.6 }) as CSSProperties;

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

/** Without `size` the CSS sizes it (the scoreboard's --pm-av). */
function Avatar({ who, tone, mood, initial, size }: { who: "you" | "sibyl" | "player"; tone: Tone; mood?: Mood; initial?: string; size?: number }) {
  return (
    <span className={`pm-avatar is-${who} is-${tone}`} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      {who === "you" ? "Y" : who === "sibyl" ? <SibylFace mood={mood ?? "neutral"} /> : initial ?? "?"}
    </span>
  );
}

type ClockTone = "calm" | "warn" | "urgent";

/** Big seconds-left readout; beeps yellow from 15s and red from 5s. */
function Countdown({ seconds, caption, tone }: { seconds: number; caption: string; tone: ClockTone }) {
  const shown = Math.max(0, seconds);
  return (
    <div className={`pm-timer is-${tone}`} role="timer" aria-label={`${shown} ${caption}`}>
      {/* Re-keyed each second, so every tick drops in (and beeps once warn/urgent). */}
      <span key={shown} className="pm-timer-num pm-num">{shown}</span>
      <span className="pm-timer-caption">{caption}</span>
    </div>
  );
}

const stakeText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * The stake chip: the amount itself is a text field between −25 and +25 at
 * either end. Clicking the digits puts the caret there; clicking anywhere else
 * in the field puts it after the number, so typing 0 turns 100 into 1000.
 * Always clamped into [0, available cash].
 */
function MatchStake({ stake, disabled }: { stake: MatchControls["stake"]; disabled: boolean }) {
  // Raw text while typing, so "12." isn't reformatted mid-keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const max = pulseMaxStake(stake.available);
  const set = (next: number) => {
    setDraft(null);
    stake.onChange(clampPulseStake(next, stake.available));
  };
  const text = draft ?? stakeText(stake.value);
  return (
    <div className={`pm-step${disabled ? " is-disabled" : ""}`}>
      <button type="button" className="pm-step-btn" disabled={disabled || stake.value <= 0} onClick={() => set(stake.value - PULSE_STAKE_STEP)} aria-label={`Decrease stake by $${PULSE_STAKE_STEP}`}>
        −{PULSE_STAKE_STEP}
      </button>
      <label
        className="pm-step-field is-input"
        onClick={(event) => {
          const input = inputRef.current;
          if (!input || input.disabled || event.target === input) return;
          // Instead of the label's own focus (caret placement varies by browser): caret after the number.
          event.preventDefault();
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }}
      >
        <span className="pm-step-label">Enter stake</span>
        <span className="pm-step-value pm-num">
          <span aria-hidden="true">$</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Stake in dollars"
            disabled={disabled}
            value={text}
            // Mono digits, so the field hugs the number and the caret sits right after it.
            style={{ width: `${Math.max(1, text.length)}ch` }}
            onChange={(event) => {
              const [whole, ...rest] = event.target.value.replace(/[^\d.]/g, "").split(".");
              const clean = rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
              const typed = Number(clean) || 0;
              const next = clampPulseStake(typed, stake.available);
              setDraft(next < typed ? stakeText(next) : clean);
              stake.onChange(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
            }}
            onBlur={() => setDraft(null)}
          />
          <span className="pm-step-caret" aria-hidden="true" />
        </span>
      </label>
      <button type="button" className="pm-step-btn" disabled={disabled || stake.value >= max} onClick={() => set(stake.value + PULSE_STAKE_STEP)} aria-label={`Increase stake by $${PULSE_STAKE_STEP}`}>
        +{PULSE_STAKE_STEP}
      </button>
    </div>
  );
}

/** The option one step down / up from `leverage` (options run 10× apart), or null past either end. */
const leverageNeighbor = (leverage: number, options: readonly number[], dir: "down" | "up") => {
  const i = options.indexOf(leverage);
  return i < 0 ? null : options[dir === "down" ? i - 1 : i + 1] ?? null;
};

/** One end of the leverage chip: ÷ or × the ratio to the neighbouring option. */
function LeverageStep({ dir, leverage, options, disabled, onChange }: { dir: "down" | "up"; leverage: number; options: readonly number[]; disabled: boolean; onChange: (leverage: number) => void }) {
  const next = leverageNeighbor(leverage, options, dir);
  const ratio = next === null ? 10 : dir === "down" ? leverage / next : next / leverage;
  return (
    <button
      type="button"
      className="pm-step-btn"
      disabled={disabled || next === null}
      onClick={() => next !== null && onChange(next)}
      aria-label={next === null ? `Leverage is at its ${dir === "down" ? "lowest" : "highest"}` : `${dir === "down" ? "Divide" : "Multiply"} leverage by ${ratio}, to ${next}×`}
    >
      <span className="pm-step-op">{dir === "down" ? "÷" : "×"}</span>{ratio}
    </button>
  );
}

/** The leverage chip: ÷10 | Leverage N× | ×10. */
function MatchLeverage({ leverage, options, onChange, disabled }: { leverage: number; options: readonly number[]; onChange: (leverage: number) => void; disabled: boolean }) {
  return (
    <div className={`pm-step is-risk${disabled ? " is-disabled" : ""}`}>
      <LeverageStep dir="down" leverage={leverage} options={options} disabled={disabled} onChange={onChange} />
      <div className="pm-step-field">
        <span className="pm-step-label">Leverage</span>
        <span className="pm-step-value pm-num">{leverage}×</span>
      </div>
      <LeverageStep dir="up" leverage={leverage} options={options} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** The flip's leverage tab starts here on every position, whatever it opened at. */
const FLIP_BASE_LEVERAGE = 100;

/**
 * Flip — a leverage tab strip (100× 1000× 10000×) on top of "Flip to Short
 * at 100×" / "out at <liq>": the tab picks the new side's leverage, the button
 * flips at it. Keyed per position by the caller, so each starts at 100×.
 */
function FlipControl({ position, options, price, disabled, onFlip }: { position: MatchPosition; options: readonly number[]; price: number | null; disabled: boolean; onFlip: (leverage: number) => void }) {
  const [leverage, setLeverage] = useState(FLIP_BASE_LEVERAGE);
  const target = position.side === "long" ? "short" : "long";
  return (
    <div className={`pm-flip is-${target}`}>
      <div className="pm-flip-tabs" role="group" aria-label="Leverage for the flip">
        {options.map((option) => (
          <button key={option} type="button" className={`pm-flip-tab pm-num${option === leverage ? " is-on" : ""}`} aria-pressed={option === leverage} disabled={disabled} onClick={() => setLeverage(option)}>
            {option}×
          </button>
        ))}
      </div>
      <button type="button" className="pm-flip-go" disabled={disabled} onClick={() => onFlip(leverage)}>
        <span className="pm-flip-title">Flip to {sideWord(target)} at {leverage}×</span>
        {/* The new side enters at the live price, so its knockout moves with it. */}
        {price !== null && (
          <span className="pm-flip-sub">out at <span className="pm-num">{priceText(liquidationPrice(target, price, leverage))}</span></span>
        )}
      </button>
    </div>
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
  /** The typed stake chip (MatchStake); `available` caps it. */
  stake: { value: number; available: number; onChange: (stake: number) => void };
  leverage: number;
  leverageOptions: readonly number[];
  onLeverage: (leverage: number) => void;
  canEdit: boolean;
  canEnter: boolean;
  onEnter: (side: MatchSide) => void;
  /** Replaces the "You're out if it moves…" helper (waiting, busted, no feed). */
  hint: string | null;
  canManage: boolean;
  onClose: () => void;
  /** Reverse into the other side at this leverage (FlipControl's pick). */
  onFlip: (leverage: number) => void;
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
          <FlipControl
            key={`${position.openedAt}-${position.side}`}
            position={position}
            options={controls.leverageOptions}
            price={price}
            disabled={!controls.canManage || position.liquidated}
            onFlip={(leverage) => {
              // The next setup starts from the leverage you flipped at.
              controls.onLeverage(leverage);
              controls.onFlip(leverage);
            }}
          />
          <div className={`pm-liq${near || position.liquidated ? " is-near" : ""}`} role="status">
            <span>Liq <span className="pm-num">{priceText(liq)}</span></span>
            <span className="pm-liq-state">{position.liquidated ? "hit" : near ? "close!" : "safe"}</span>
          </div>
        </div>
        {messages}
      </section>
    );
  }

  return (
    <section className="pm-controls is-setup" aria-label="Place a trade">
      <div className="pm-controls-row is-picks">
        <MatchStake stake={controls.stake} disabled={!controls.canEdit} />
        <MatchLeverage leverage={controls.leverage} options={controls.leverageOptions} onChange={controls.onLeverage} disabled={!controls.canEdit} />
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
            {/* The arrow sits on the outer side: ↑ Long | Short ↓. */}
            <span className={`pm-trade-title${side === "short" ? " is-trailing" : ""}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={side === "long" ? "M12 19V5M5.5 11.5L12 5l6.5 6.5" : "M12 5v14M5.5 12.5L12 19l6.5-6.5"} />
              </svg>
              {sideWord(side)}
            </span>
          </button>
        ))}
      </div>
      {/* is-default: the generic helper, hidden on phones; a real hint (waiting, busted, no feed) always shows. */}
      <p className={`pm-helper${controls.hint ? "" : " is-default"}`}>{controls.hint ?? `You're out if it moves ${liqPercent(controls.leverage)}% the wrong way`}</p>
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
    /** Sibyl's latest line: her status under her balance (re-keyed per line). */
    line?: { text: string; key: number } | null;
  };
  /** caption reads after the number: "seconds left", "to start". */
  timer: { seconds: number; caption: string; /** Counting down a live round (the 15s/5s beeps). */ live: boolean };
  /** The room's event line (multiplayer), floated under the scoreboard. */
  bubble: { text: string; key: number } | null;
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

  const clockLive = timer.live && timer.seconds > 0 && !result;
  const clockTone: ClockTone = !clockLive ? "calm" : timer.seconds <= 5 ? "urgent" : timer.seconds <= 15 ? "warn" : "calm";
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

  // Tick sound with each beep, once per second from 15s.
  const beeping = clockTone !== "calm";
  useEffect(() => {
    if (beeping) sound.play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beeping ? timer.seconds : null]);

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
      ? "Dead even"
      : (
        <>
          <span className="pm-lead-amount pm-num"><RollingNumber text={matchSignedUsd(leadDelta)} /></span>
          <span className="pm-lead-word">
            {display === "you" ? "ahead" : "behind"}
            <span className="sr-only">{display === "you" ? ` of ${rival.name}` : ` ${rival.name}`}</span>
          </span>
        </>
      );
  const rivalLabel = `${rival.name}${rival.side ? ` · ${sideWord(rival.side)}` : rival.kind === "sibyl" ? " · AI" : ""}`;
  const youStatus = position
    ? position.liquidated
      ? "Liquidated"
      : <><span className={`is-${position.side}`}>{sideWord(position.side)}</span> {position.leverage}× from <span className="pm-num">{priceText(position.entryPrice)}</span></>
    : "No position yet";
  const rivalStatus = rival.line?.text
    ?? (rival.side ? <><span className={`is-${rival.side}`}>{sideWord(rival.side)}</span> position</> : rival.kind === "sibyl" ? "Waiting for a clearer move" : "Side hidden until the bell");
  const youBal = matchUsd(Math.max(0, you.equity));
  const rivalBal = matchUsd(Math.max(0, rival.equity));
  const youPct = Math.round(share);
  const identity = MARKET_IDENTITY[market] ?? null;

  return (
    <main
      className={`pm-screen${clockTone === "urgent" ? " is-final" : ""}${result ? " is-result" : ""}`}
      data-market={market}
    >
      <PulseMovementAlert total={alertTotal} />
      {(clockTone === "urgent" || nearLiq) && <div className="pm-edge" aria-hidden="true" />}

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
              <div className="pm-player">
                <Avatar who="you" tone={youTone} />
                <div className="pm-player-text">
                  <div className="pm-player-label">You</div>
                  <div className="pm-player-bal pm-num" style={balStyle(youBal)}>{youBal}</div>
                  <div className="pm-player-sub">{youStatus}</div>
                </div>
              </div>
              <div className="pm-clock">
                <Countdown seconds={timer.seconds} caption={timer.caption} tone={clockTone} />
                <p className={`pm-lead is-${display}`}>{leadText}</p>
              </div>
              <div className="pm-player is-rival">
                <Avatar who={rival.kind === "sibyl" ? "sibyl" : "player"} tone={rivalTone} mood={mood} initial={rival.initial} />
                <div className="pm-player-text">
                  <div className="pm-player-label">{rivalLabel}</div>
                  <div className="pm-player-bal pm-num" style={balStyle(rivalBal)}>{rivalBal}</div>
                  <div key={rival.line?.key} className="pm-player-sub">{rivalStatus}</div>
                </div>
              </div>
              {/* Two separate bars with a gap at the split, each end labelled with its share. */}
              <div className={`pm-tug${shaking ? " is-shaking" : ""}`} aria-hidden="true">
                <span className="pm-tug-pct is-you pm-num">{youPct}%</span>
                <div className="pm-tug-track">
                  <span className="pm-tug-you" style={{ width: `calc(${share}% - 3px)` }} />
                  <span className="pm-tug-rival" />
                </div>
                <span className="pm-tug-pct is-rival pm-num">{100 - youPct}%</span>
              </div>
            </section>

            {bubble && (
              <div className="pm-bubble-row">
                <p key={bubble.key} className="pm-bubble">{bubble.text}</p>
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
