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

/** One compact line of session state above the three columns. */
export function SessionStrip({
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
  const elapsed = Math.min(1, Math.max(0, 1 - countdownMs / PORTFOLIO_SESSION_MS));
  const ended = countdownMs <= 0;
  const equityFlash = useFlash(Math.round(session.equity));

  return (
    <section
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-[var(--surface)] px-4 py-3"
      aria-label="Session performance"
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="flex items-center gap-1.5 self-center whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          <span className={`pf-live-dot ${ended ? "opacity-40" : ""}`} aria-hidden="true" />
          {ended ? "Settling" : "Live"}
        </span>
        <span className={`flex items-baseline gap-1.5 rounded-md ${equityFlash}`}>
          <span className="text-2xl font-semibold leading-none tabular-nums text-[var(--text)]">{num(session.equity)}</span>
          <EmberIcon className="h-3.5 w-3.5" />
        </span>
        <span className="whitespace-nowrap text-sm font-medium tabular-nums" style={{ color: pnlColor(performance) }}>
          {signed(performance)} · {pct(performancePct)}
        </span>
      </div>

      <dl className="flex gap-5 text-xs">
        <StripStat label="Started" value={num(session.startingBalance)} />
        <StripStat label="Realized" value={signed(session.realizedPnl)} color={pnlColor(session.realizedPnl)} />
        <StripStat label="Open P&L" value={signed(openPnl)} color={pnlColor(openPnl)} />
      </dl>

      <div className="ml-auto flex items-center gap-2.5" title={`Session ends ${formatEnd(session.endAt)}`}>
        <TimeRing progress={elapsed} />
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{ended ? "Session ended" : "Ends in"}</p>
          <p className="text-base font-semibold leading-tight tabular-nums text-[var(--text)]" role="timer" aria-live="off">
            {ended ? "Settling…" : formatCountdown(countdownMs)}
          </p>
        </div>
      </div>
    </section>
  );
}

function StripStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">{label}</dt>
      <dd className="font-semibold tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}

/** Available vs committed capital, at the top of the portfolio column. */
export function BuyingPower({ session }: { session: SessionView }) {
  const capital = session.availableCash + session.committedCash;
  const committedShare = capital > 0 ? Math.min(1, session.committedCash / capital) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Available</p>
        <p className="text-[11px] tabular-nums text-[var(--muted-dim)]">{Math.round(committedShare * 100)}% deployed</p>
      </div>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums text-[var(--text)]">{num(session.availableCash)}</span>
        <EmberIcon className="h-3.5 w-3.5" />
      </p>
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--line)]"
        role="img"
        aria-label={`${num(session.availableCash)} Embers available, ${num(session.committedCash)} committed`}
      >
        <span className="pf-bar-segment h-full rounded-full bg-[var(--brand)]" style={{ width: `${committedShare * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-[var(--muted)]">{num(session.committedCash)} committed in open positions</p>
    </div>
  );
}

function TimeRing({ progress }: { progress: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle
        cx="16"
        cy="16"
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

export function SessionStripSkeleton() {
  return (
    <section className="flex items-center gap-4 rounded-xl bg-[var(--surface)] px-4 py-3" aria-busy="true" aria-label="Loading session">
      <div className="pf-shimmer h-7 w-40 rounded" />
      <div className="pf-shimmer h-5 w-56 rounded" />
      <div className="pf-shimmer ml-auto h-7 w-24 rounded" />
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
