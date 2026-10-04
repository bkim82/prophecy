"use client";

import type { OpenPositionView } from "./types";
import { CoinImage, num, pct, pnlColor, signed, useFlash, usd } from "./ui";

const edgeColor = (position: OpenPositionView) =>
  position.kind === "spot" ? "var(--spot)" : position.side === "long" ? "var(--brand)" : "var(--negative)";

const badge = (position: OpenPositionView) =>
  position.kind === "spot" ? "Spot" : `${position.side === "long" ? "Long" : "Short"} · ${position.leverage}×`;

const openedAgo = (openedAt: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60_000));
  if (minutes < 1) return "Opened just now";
  if (minutes < 60) return `Opened ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Opened ${hours}h ${minutes % 60}m ago`;
};

export function OpenPositions({
  positions,
  closingId,
  closeError,
  onClose,
  now,
  freshId,
}: {
  positions: OpenPositionView[];
  closingId: string | null;
  closeError: string | null;
  onClose: (id: string) => void;
  now: number;
  /** A just-confirmed position: slides in and highlights its border once. */
  freshId: string | null;
}) {
  const newestFirst = positions.slice().sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

  return (
    <section aria-label="Open positions">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Open positions</h2>
        {positions.length > 0 && <span className="text-xs tabular-nums text-[var(--muted-dim)]">{positions.length}</span>}
      </div>

      {closeError && (
        <p className="mt-2 rounded-lg bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] px-3 py-2 text-xs text-[var(--negative)]" role="alert">
          {closeError}
        </p>
      )}

      {positions.length === 0 ? (
        <div className="mt-2 rounded-xl bg-[var(--surface-raised)] px-5 py-8 text-center">
          <p className="text-sm font-medium text-[var(--text)]">No open positions</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Positions appear here once an order is filled, with live P&L.</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {newestFirst.map((position) => (
            <PositionCard
              key={position.id}
              fresh={position.id === freshId}
              position={position}
              closing={closingId === position.id}
              disabled={closingId !== null}
              onClose={onClose}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PositionCard({
  fresh,
  position,
  closing,
  disabled,
  onClose,
  now,
}: {
  fresh: boolean;
  position: OpenPositionView;
  closing: boolean;
  disabled: boolean;
  onClose: (id: string) => void;
  now: number;
}) {
  const returnPct = position.committedCash > 0 ? (position.unrealizedPnl / position.committedCash) * 100 : 0;
  const flash = useFlash(position.unrealizedPnl);

  return (
    <li className={`relative overflow-hidden rounded-xl bg-[var(--surface-raised)] py-3 pl-4 pr-3 ${fresh ? "pf-position-enter" : ""}`}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: edgeColor(position) }} aria-hidden="true" />

      <div className="flex items-center gap-2.5">
        <CoinImage src={position.imageUrl} symbol={position.tokenSymbol} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-[var(--text)]">{position.tokenName}</p>
          <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            {position.tokenSymbol}
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider" style={{ color: edgeColor(position) }}>
              {badge(position)}
            </span>
          </p>
        </div>
        <div className={`shrink-0 rounded-md px-1 text-right ${flash}`}>
          <p className="text-lg font-semibold leading-tight tabular-nums" style={{ color: pnlColor(position.unrealizedPnl) }}>
            {signed(position.unrealizedPnl)}
          </p>
          <p className="text-[11px] text-[var(--muted)]">Embers</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-1.5 text-xs">
        <Cell label="Size" value={num(position.committedCash)} />
        <Cell label="Entry" value={usd(position.entryPrice)} />
        <Cell label="Current" value={usd(position.markPrice)} />
        <Cell label="Return" value={pct(returnPct, 1)} color={pnlColor(position.unrealizedPnl)} />
      </dl>

      <div className="mt-2.5 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted-dim)]">
          {openedAgo(position.openedAt, now)}
          {position.priceStale && <span className="ml-1.5 text-[var(--muted)]">· price delayed</span>}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onClose(position.id)}
          className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:opacity-50 sm:min-h-9"
        >
          {position.kind === "spot" ? (closing ? "Selling…" : "Sell") : closing ? "Closing…" : "Close"}
        </button>
      </div>
    </li>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">{label}</dt>
      <dd className="mt-0.5 truncate font-medium tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}
