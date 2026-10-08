"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlameIcon } from "@/app/icons";

/**
 * Arena pieces shared by solo practice Pulse (app/duel/btc/pulse/page.tsx) and
 * the multiplayer room (app/duel/[market]/pulse/[matchId]/page.tsx), so both
 * read as the same game.
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const arenaUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const arenaSignedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${arenaUsd(Math.abs(n))}`;

const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");

export const YOU_GRADIENT = "linear-gradient(135deg, var(--brand), var(--brand-strong))";
export const RIVAL_GRADIENT = "linear-gradient(135deg, var(--violet), var(--violet-strong))";

export function CountdownRing({ seconds, total, urgent }: { seconds: number; total: number; urgent: boolean }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? clamp(seconds / total, 0, 1) : 0;
  return (
    <svg viewBox="0 0 72 72" className="h-9 w-9 sm:h-11 sm:w-11">
      <circle className="duel-ring-track" cx="36" cy="36" r={r} strokeWidth="5" />
      <circle
        className={`duel-ring-progress ${urgent ? "is-urgent" : ""}`}
        cx="36"
        cy="36"
        r={r}
        strokeWidth="5"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
      />
      <text
        x="36"
        y="41"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill={urgent ? "var(--negative)" : "var(--text)"}
        className="tabular-nums"
      >
        {Math.max(0, Math.round(seconds))}
      </text>
    </svg>
  );
}

export function LeadBar({ leadDelta, maxLead, rivalName }: { leadDelta: number; maxLead: number; rivalName: string }) {
  const pct = clamp(50 + (leadDelta / Math.max(1, maxLead)) * 50, 0, 100);
  const side: "you" | "rival" | "tie" = leadDelta > 0.5 ? "you" : leadDelta < -0.5 ? "rival" : "tie";
  const label =
    side === "tie"
      ? "Tied"
      : side === "you"
        ? `You lead by ${arenaUsd(Math.abs(leadDelta))}`
        : `${rivalName} leads by ${arenaUsd(Math.abs(leadDelta))}`;
  return (
    <div className="mt-3">
      <div className="duel-lead-bar">
        <div className="duel-lead-mid" />
        <div
          className="duel-lead-fill"
          style={{ width: `${pct}%`, backgroundColor: side === "rival" ? "var(--chart-down)" : "var(--chart-up)" }}
        />
      </div>
      <p className="mt-1.5 text-center text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

export function ArenaScore({
  name,
  equity,
  pnl,
  align,
  href,
}: {
  name: string;
  equity: number;
  pnl: number;
  align: "left" | "right";
  /** Makes the name a profile link. */
  href?: string;
}) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : ""}`}>
        {href ? (
          <Link href={href} className="truncate text-[10px] font-semibold tracking-wider text-[var(--text)] underline-offset-2 hover:underline">
            {name}
          </Link>
        ) : (
          <span className="truncate text-[10px] uppercase tracking-wider text-[var(--muted)]">{name}</span>
        )}
      </div>
      <div className="text-sm font-semibold tabular-nums text-[var(--text)]">{arenaUsd(equity)}</div>
      <div className="text-[10px] font-medium tabular-nums" style={{ color: pnlColor(pnl) }}>
        {arenaSignedUsd(pnl)} P&amp;L
      </div>
    </div>
  );
}

export function ResultBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        rot: (360 / 14) * i + Math.random() * 12,
        dist: 70 + Math.random() * 40,
        delay: Math.random() * 0.15,
      })),
    [],
  );
  return (
    <div className="result-burst" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="result-burst-particle"
          style={
            {
              "--rot": `${p.rot}deg`,
              "--dist": `-${p.dist}px`,
              animationDelay: `${p.delay}s`,
              background: p.id % 2 ? "var(--chart-up)" : "var(--brand)",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Headline price that flashes green/red on a whole-tick move — same cue as
 * the lobby ticker. Only the characters that actually changed flash, so the
 * whole number never re-animates on every tick.
 */
export function FlashingPrice({ price }: { price: number | null }) {
  const [flash, setFlash] = useState<{ key: number; dir: "up" | "down"; mask: boolean[] }>({
    key: 0,
    dir: "up",
    mask: [],
  });
  const prevRef = useRef<number | null>(null);
  const prevStrRef = useRef<string | null>(null);
  const text = price === null ? "Loading…" : arenaUsd(price);

  useEffect(() => {
    const prevNum = prevRef.current;
    const prevStr = prevStrRef.current;
    prevRef.current = price;
    const nextStr = price === null ? null : arenaUsd(price);
    prevStrRef.current = nextStr;
    if (prevNum === null || price === null || price === prevNum || nextStr === null) return;
    const dir = price > prevNum ? "up" : "down";
    const mask =
      prevStr && nextStr.length === prevStr.length
        ? nextStr.split("").map((ch, i) => ch !== prevStr[i])
        : nextStr.split("").map(() => true);
    setFlash((f) => ({ key: f.key + 1, dir, mask }));
  }, [price]);

  return (
    <>
      {text.split("").map((ch, i) => (
        <span
          key={`${flash.key}-${i}`}
          className={flash.key > 0 && flash.mask[i] ? `price-flash is-${flash.dir}` : undefined}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

const MUTE_STORAGE_KEY = "pulse-sound-muted";

/**
 * Entry/exit/reverse feedback: haptics always, a short Web Audio tick only
 * once the player turns sound on (muted by default, remembered per browser).
 */
export function usePulseFeedback() {
  const [muted, setMuted] = useState(true);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_STORAGE_KEY) !== "0");
    } catch {
      // localStorage can throw in locked-down contexts; default stays muted.
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  }, []);

  const playFeedback = useCallback((kind: "entry" | "exit" | "reverse") => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "reverse" ? [12, 24, 12] : 12);
    }
    if (mutedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = kind === "reverse" ? 520 : kind === "entry" ? 410 : 260;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
      window.setTimeout(() => void context.close(), 150);
    } catch {
      // Audio is a progressive enhancement; the interaction stays functional.
    }
  }, []);

  return { muted, toggleMuted, playFeedback };
}

export function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      className="flex items-center gap-1.5 transition hover:text-[var(--text)]"
    >
      <svg aria-hidden="true" viewBox="0 0 18 18" className="h-3.5 w-3.5">
        <path
          d="M3 7v4h2.5L9 14V4L5.5 7H3Zm8.4 1.1a2.3 2.3 0 0 1 0 2.8M13.6 6a5.1 5.1 0 0 1 0 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>{" "}
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}

/**
 * One chart/trade-log event. Closing events (exit, reverse) carry the leg
 * they closed, so the result card can list whole trades (entry → exit)
 * without re-pairing events.
 */
export type ArenaTrade = {
  side: "long" | "short";
  action: "entry" | "exit" | "reverse";
  price: number;
  pnl?: number;
  /** On exit/reverse: the position this event closed. */
  closed?: { side: "long" | "short"; entry: number; exit: number };
};

/** A finished position: what the result card's trade review lists. */
export type RoundTrade = { side: "long" | "short"; entry: number; exit: number; pnl: number };

export const roundTrades = (events: ArenaTrade[]): RoundTrade[] =>
  events.flatMap((event) =>
    event.closed && event.pnl !== undefined ? [{ ...event.closed, pnl: event.pnl }] : [],
  );

/** The round's biggest mover, as a short headline plus the prices behind it. */
export function roundTakeaway(trades: RoundTrade[]): { title: string; detail: string } {
  if (trades.length === 0) {
    return { title: "No trades this round", detail: "The clock ran out before a side was picked." };
  }
  const biggest = trades.reduce((a, b) => (Math.abs(b.pnl) > Math.abs(a.pnl) ? b : a));
  const kind = isFlat(biggest.pnl) ? "Flat round" : biggest.pnl > 0 ? "Largest win" : "Largest loss";
  return {
    title: `${kind}: ${biggest.side === "long" ? "Long" : "Short"} · ${tradePnlText(biggest.pnl)}`,
    detail: `Entered at ${arenaUsd(biggest.entry)}; exited at ${arenaUsd(biggest.exit)}.`,
  };
}

// A flat trade reads "$0.00" in a neutral tone rather than "+$0.00" in green.
const isFlat = (n: number) => Math.abs(n) < 0.005;
const tradePnlText = (n: number) => (isFlat(n) ? arenaUsd(0) : arenaSignedUsd(n));
const tradePnlColor = (n: number) => (isFlat(n) ? "var(--muted)" : pnlColor(n));

const initialOf = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?";

function CrossedSwords() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
      <path d="M9.5 6.5 18 3h3v3l-3.5 8.5" />
      <path d="m5 14 4 4M7 17l-3 3M3 19l2 2" />
    </svg>
  );
}

function VersusSide({
  name,
  nameNode,
  avatar,
  gradient,
  equity,
  pnl,
  winner,
  align,
}: {
  name: string;
  nameNode?: React.ReactNode;
  avatar?: React.ReactNode;
  gradient: string;
  equity: number;
  pnl: number;
  winner: boolean;
  align: "left" | "right";
}) {
  return (
    <div
      className={`relative min-w-0 rounded-lg border p-3 ${align === "right" ? "text-right" : "text-left"} ${
        winner
          ? "border-[color-mix(in_srgb,var(--violet)_70%,transparent)] bg-[color-mix(in_srgb,var(--violet)_8%,var(--surface-raised))]"
          : "border-[var(--line)] bg-[var(--surface-raised)]"
      }`}
    >
      <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <div className="duel-avatar h-7 w-7 text-[11px]" style={{ backgroundImage: gradient }} aria-hidden="true">
          {avatar ?? initialOf(name)}
        </div>
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{nameNode ?? name}</span>
        {winner && (
          <span className="flex-none rounded-full border border-[color-mix(in_srgb,var(--violet)_70%,transparent)] px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[var(--violet-strong)]">
            Winner
          </span>
        )}
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--muted)]">Final balance</p>
      <p className="text-xl font-semibold tabular-nums text-[var(--text)]">{arenaUsd(equity)}</p>
      <p className="mt-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">Round P&amp;L</p>
      <p className="text-sm font-semibold tabular-nums" style={{ color: pnlColor(pnl) }}>
        {arenaSignedUsd(pnl)}
      </p>
    </div>
  );
}

/**
 * End-of-round card: outcome header with the dollar gap, a versus scoreboard
 * (final balance + round P&L, winner badged), the round's biggest mover,
 * Play Again, and the trade review (collapsed). Final price sits in the footer.
 */
export function ArenaResultCard({
  marketLabel,
  finalPrice,
  winner,
  rivalName,
  rivalHref,
  rivalAvatar,
  yourEquity,
  yourPnl,
  rivalEquity,
  rivalPnl,
  trades,
  wager,
  playAgain,
}: {
  marketLabel: string;
  finalPrice: number | null;
  winner: "you" | "rival" | "tie";
  rivalName: string;
  /** Makes the rival's name a profile link. */
  rivalHref?: string;
  /** Replaces the rival's initial inside the avatar (e.g. Sibyl's face). */
  rivalAvatar?: React.ReactNode;
  yourEquity: number;
  yourPnl: number;
  rivalEquity: number;
  rivalPnl: number;
  /** The player's own trade events this round. */
  trades: ArenaTrade[];
  /** Embers each player staked on the match; omitted for practice (nothing at stake). */
  wager?: number;
  playAgain: React.ReactNode;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const rows = roundTrades(trades);
  const takeaway = roundTakeaway(rows);
  const gap = Math.abs(yourEquity - rivalEquity);
  const rivalLabel = rivalHref ? (
    <Link href={rivalHref} className="underline-offset-2 hover:underline">{rivalName}</Link>
  ) : (
    rivalName
  );
  const title = winner === "tie" ? "Round drawn" : winner === "you" ? "Round won" : "Round lost";
  const subtitle =
    winner === "tie" ? (
      "Dead even at the bell"
    ) : winner === "you" ? (
      <>You finished {arenaUsd(gap)} ahead</>
    ) : (
      <>{rivalLabel} finished {arenaUsd(gap)} ahead</>
    );

  return (
    <div className="relative">
      {winner === "you" && <ResultBurst />}
      <div className="flex items-center justify-center gap-2 text-[var(--muted)]">
        <CrossedSwords />
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em]">Pulse duel</span>
      </div>
      <h3
        className="mt-1 text-center text-2xl font-bold"
        style={{ color: winner === "you" ? "var(--positive)" : winner === "rival" ? "var(--negative)" : "var(--text)" }}
      >
        {title}
      </h3>
      <p className="mt-0.5 text-center text-sm text-[var(--muted)]">{subtitle}</p>
      {wager !== undefined && (
        <p
          className="mx-auto mt-2 flex w-fit items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold tabular-nums"
          style={{ color: winner === "you" ? "var(--positive)" : winner === "rival" ? "var(--negative)" : "var(--muted)" }}
        >
          <FlameIcon className="balance-ember-icon" />
          {winner === "you"
            ? `+${wager * 2} Embers · took the pot`
            : winner === "rival"
              ? `−${wager} Embers · wager lost`
              : `${wager} Embers refunded`}
        </p>
      )}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <VersusSide name="You" gradient={YOU_GRADIENT} equity={yourEquity} pnl={yourPnl} winner={winner === "you"} align="left" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--muted-dim)]">VS</span>
        <VersusSide
          name={rivalName}
          nameNode={rivalLabel}
          avatar={rivalAvatar}
          gradient={RIVAL_GRADIENT}
          equity={rivalEquity}
          pnl={rivalPnl}
          winner={winner === "rival"}
          align="right"
        />
      </div>

      <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2.5 text-center">
        <p className="text-sm font-semibold text-[var(--text)]">{takeaway.title}</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{takeaway.detail}</p>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {playAgain}
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => setReviewOpen((o) => !o)}
            aria-expanded={reviewOpen}
            className="rounded-md border border-[var(--line)] px-5 py-2 text-sm text-[var(--text)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
          >
            {reviewOpen ? "Hide trades" : `Review ${rows.length} trade${rows.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      {reviewOpen && rows.length > 0 && (
        <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface-raised)] p-3">
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 text-xs">
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">Position</span>
            <span className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">Entry → Exit</span>
            <span className="text-right text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">P&amp;L</span>
            {rows.map((row, i) => {
              const color = row.side === "long" ? "var(--chart-up)" : "var(--chart-down)";
              return (
                <div key={i} className="contents">
                  <span>
                    <span
                      className="inline-block rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide"
                      style={{ color, borderColor: `color-mix(in srgb, ${color} 55%, transparent)` }}
                    >
                      {row.side}
                    </span>
                  </span>
                  <span className="truncate tabular-nums text-[var(--muted-dim)]">
                    {arenaUsd(row.entry)} → {arenaUsd(row.exit)}
                  </span>
                  <span className="text-right font-semibold tabular-nums" style={{ color: tradePnlColor(row.pnl) }}>
                    {tradePnlText(row.pnl)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">
        Final {marketLabel} {finalPrice === null ? "unavailable" : arenaUsd(finalPrice)}
      </p>
    </div>
  );
}
