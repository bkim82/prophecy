"use client";

import { PORTFOLIO_MAX_STAKE, PORTFOLIO_SESSION_MS } from "@/lib/portfolioRules";
import type { SessionView } from "./types";
import { EmberIcon, num, pct, pnlColor, signed, useFlash } from "./ui";

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const formatEnd = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STAKE_PRESETS = [100, 500, 1000];

export function SessionHero({
  session,
  openPnl,
  countdownMs,
}: {
  session: SessionView;
  openPnl: number;
  countdownMs: number;
}) {
  const performance = session.equity - session.startingBalance;
  const performancePct = session.startingBalance > 0 ? (performance / session.startingBalance) * 100 : 0;
  const capital = session.availableCash + session.committedCash;
  const committedShare = capital > 0 ? Math.min(1, session.committedCash / capital) : 0;
  const elapsed = Math.min(1, Math.max(0, 1 - countdownMs / PORTFOLIO_SESSION_MS));
  const ended = countdownMs <= 0;
  const equityFlash = useFlash(Math.round(session.equity));

  return (
    <section className="rounded-xl bg-[var(--surface)] p-4 sm:p-5" aria-label="Session performance">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        {/* Equity */}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] sm:text-[11px]">
            <span className={`pf-live-dot ${ended ? "opacity-40" : ""}`} aria-hidden="true" />
            {ended ? "Settling" : "Live"} · 24h <span className="hidden sm:inline">portfolio</span> session
          </p>
          <p className={`mt-1.5 flex items-baseline gap-2 rounded-md ${equityFlash}`}>
            <span className="text-3xl font-semibold leading-none tabular-nums text-[var(--text)] sm:text-4xl">{num(session.equity)}</span>
            <span className="flex items-center gap-1 text-sm text-[var(--muted)]">
              <EmberIcon className="h-4 w-4" />
              Embers
            </span>
          </p>
          <p className="mt-1.5 whitespace-nowrap text-xs font-medium tabular-nums sm:text-sm" style={{ color: pnlColor(performance) }}>
            {signed(performance)} Embers · {pct(performancePct)}
          </p>
        </div>

        {/* Countdown — second on phones so it shares the top row with equity */}
        <div className="flex items-center gap-3 md:order-3">
          <TimeRing progress={elapsed} />
          <div className="text-right md:text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] sm:text-[11px]">
              {ended ? "Session ended" : "Session ends in"}
            </p>
            <p className="mt-0.5 text-xl font-semibold leading-tight tabular-nums text-[var(--text)] sm:text-2xl" role="timer" aria-live="off">
              {ended ? "Settling…" : formatCountdown(countdownMs)}
            </p>
            <p className="text-[11px] text-[var(--muted-dim)]">{formatEnd(session.endAt)}</p>
          </div>
        </div>

        {/* Buying power */}
        <div className="col-span-2 md:order-2 md:col-span-1 md:px-2">
          <div className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <span>Buying power</span>
            <span className="tabular-nums normal-case tracking-normal text-[var(--muted-dim)]">{Math.round(committedShare * 100)}% deployed</span>
          </div>
          <div
            className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--line)]"
            role="img"
            aria-label={`${num(session.availableCash)} Embers available, ${num(session.committedCash)} committed`}
          >
            <span className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500" style={{ width: `${committedShare * 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs tabular-nums">
            <span className="flex items-center gap-1.5 text-[var(--text)]">
              <span className="h-2 w-2 rounded-full bg-[var(--line-strong)]" aria-hidden="true" />
              {num(session.availableCash)} <span className="text-[var(--muted)]">available</span>
            </span>
            <span className="flex items-center gap-1.5 text-[var(--text)]">
              <span className="h-2 w-2 rounded-full bg-[var(--brand)]" aria-hidden="true" />
              {num(session.committedCash)} <span className="text-[var(--muted)]">committed</span>
            </span>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[color-mix(in_srgb,var(--line)_60%,transparent)] pt-3">
        <HeroStat label="Starting" value={num(session.startingBalance)} />
        <HeroStat label="Realized P&L" value={signed(session.realizedPnl)} color={pnlColor(session.realizedPnl)} />
        <HeroStat label="Open P&L" value={signed(openPnl)} color={pnlColor(openPnl)} />
      </dl>
    </section>
  );
}

function HeroStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wider text-[var(--muted)] sm:text-[11px]">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}

function TimeRing({ progress }: { progress: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="hidden shrink-0 -rotate-90 sm:block" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        className="transition-[stroke-dashoffset] duration-1000"
      />
    </svg>
  );
}

export function SessionHeroSkeleton() {
  return (
    <section className="rounded-xl bg-[var(--surface)] p-5" aria-busy="true" aria-label="Loading session">
      <div className="pf-shimmer h-3 w-40 rounded" />
      <div className="pf-shimmer mt-3 h-9 w-48 rounded" />
      <div className="pf-shimmer mt-3 h-3 w-full rounded" />
    </section>
  );
}

export function StartPanel({
  busy,
  error,
  onStart,
}: {
  busy: boolean;
  error: string | null;
  onStart: (stake: number) => void;
}) {
  return (
    <section className="rounded-xl bg-[var(--surface)] px-5 py-8 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">24h Portfolio</p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">Draft your 24-hour portfolio</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
        Pick a stake, then buy, long or short any Base coin. Whatever your portfolio is worth when the clock runs out is yours.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        {STAKE_PRESETS.map((stake) => (
          <button
            key={stake}
            type="button"
            disabled={busy}
            onClick={() => onStart(stake)}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--surface-raised)] px-5 text-sm font-semibold tabular-nums text-[var(--text)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:opacity-50"
          >
            <EmberIcon className="h-3.5 w-3.5" />
            {num(stake)}
          </button>
        ))}
      </div>
      {busy && <p className="mt-3 text-xs text-[var(--muted)]">Starting your session…</p>}
      {error && (
        <p className="mt-3 text-xs text-[var(--negative)]" role="alert">
          {error}
        </p>
      )}
      <p className="mt-4 text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">Max stake {num(PORTFOLIO_MAX_STAKE)} Embers</p>
    </section>
  );
}
