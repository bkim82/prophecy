"use client";

import type { OpenPositionView } from "./types";
import { CoinImage, num, pnlColor, signed } from "./ui";

// Committed capital per coin as turquoise segments of decreasing strength,
// available capital as the muted remainder — one bar, no rainbow palette.
const SEGMENT_OPACITY = [1, 0.72, 0.52, 0.38, 0.28];

export function PortfolioSummary({
  positions,
  availableCash,
  openPnl,
}: {
  positions: OpenPositionView[];
  availableCash: number;
  openPnl: number;
}) {
  if (positions.length === 0) return null;

  const byCoin = new Map<string, { symbol: string; imageUrl: string | null; committed: number }>();
  for (const position of positions) {
    const entry = byCoin.get(position.tokenAddress) ?? { symbol: position.tokenSymbol, imageUrl: position.imageUrl, committed: 0 };
    entry.committed += position.committedCash;
    byCoin.set(position.tokenAddress, entry);
  }
  const coins = Array.from(byCoin.entries())
    .map(([address, coin]) => ({ address, ...coin }))
    .sort((a, b) => b.committed - a.committed);
  const committed = coins.reduce((total, coin) => total + coin.committed, 0);
  const total = committed + Math.max(0, availableCash);
  const exposure = positions.reduce((sum, position) => sum + position.committedCash * (position.kind === "leverage" ? (position.leverage ?? 1) : 1), 0);
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  return (
    <section className="rounded-xl bg-[var(--surface)] p-4" aria-label="Portfolio breakdown">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Allocation</h2>
      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={coins.map((coin) => `${coin.symbol} ${Math.round(share(coin.committed))}%`).join(", ") + `, available ${Math.round(share(availableCash))}%`}>
        {coins.map((coin, i) => (
          <span
            key={coin.address}
            className="h-full transition-[width] duration-500"
            style={{ width: `${share(coin.committed)}%`, backgroundColor: "var(--brand)", opacity: SEGMENT_OPACITY[Math.min(i, SEGMENT_OPACITY.length - 1)] }}
          />
        ))}
        <span className="h-full flex-1 bg-[var(--line)]" />
      </div>

      <ul className="mt-3 space-y-1.5">
        {coins.map((coin, i) => (
          <li key={coin.address} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]"
              style={{ opacity: SEGMENT_OPACITY[Math.min(i, SEGMENT_OPACITY.length - 1)] }}
              aria-hidden="true"
            />
            <CoinImage src={coin.imageUrl} symbol={coin.symbol} size={24} />
            <span className="flex-1 truncate font-medium text-[var(--text)]">{coin.symbol}</span>
            <span className="tabular-nums text-[var(--text)]">{num(coin.committed)}</span>
            <span className="w-10 text-right tabular-nums text-[var(--muted)]">{Math.round(share(coin.committed))}%</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--line-strong)]" aria-hidden="true" />
          <span className="w-6 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[var(--muted)]">Available</span>
          <span className="tabular-nums text-[var(--text)]">{num(availableCash)}</span>
          <span className="w-10 text-right tabular-nums text-[var(--muted)]">{Math.round(share(availableCash))}%</span>
        </li>
      </ul>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[color-mix(in_srgb,var(--line)_60%,transparent)] pt-3">
        <Stat label="Available" value={num(availableCash)} />
        <Stat label="Total exposure" value={num(exposure)} />
        <Stat label="Open P&L" value={signed(openPnl)} color={pnlColor(openPnl)} />
      </dl>
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wider text-[var(--muted-dim)]">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}
