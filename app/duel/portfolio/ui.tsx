"use client";

import { useEffect, useRef, useState } from "react";
import { FlameIcon } from "@/app/icons";

// Shared formatting + small visual primitives for the 24h Portfolio room.

const MINUS = "−";
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

export const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** "+24", "−12", "0" — a true minus sign so signed columns line up. */
export const signed = (n: number) => {
  const rounded = Math.round(n);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : MINUS}${num(Math.abs(rounded))}`;
};

export const pct = (n: number, digits = 2) => {
  const fixed = Math.abs(n).toFixed(digits);
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%`;
  return `${n > 0 ? "+" : MINUS}${fixed}%`;
};

/** Meme-coin-friendly USD: $1,234.56 · $0.005821 · $0.0₅1234 for very small prices. */
export const usd = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (n >= 0.0001) return `$${Number(n.toPrecision(4))}`;
  const zeros = Math.floor(-Math.log10(n)); // leading zeros after "0."
  const digits = Math.round(n * 10 ** (zeros + 3)).toString().replace(/0+$/, "") || "0";
  const sub = String(zeros).split("").map((d) => SUBSCRIPT[Number(d)]).join("");
  return `$0.0${sub}${digits}`;
};

export const compactUsd = (n: number) =>
  `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;

/** Profit green / loss red only for real P&L; zero stays muted. */
export const pnlColor = (n: number) =>
  Math.round(n) > 0 ? "var(--positive)" : Math.round(n) < 0 ? "var(--negative)" : "var(--muted)";

/** Same rule for a percentage that rounds to zero at the shown precision. */
export const changeColor = (n: number | null, digits = 2) => {
  if (n === null || Number(Math.abs(n).toFixed(digits)) === 0) return "var(--muted)";
  return n > 0 ? "var(--positive)" : "var(--negative)";
};

export function EmberIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span className="inline-flex text-[var(--ember)]">
      <FlameIcon className={className} />
    </span>
  );
}

/** Token logo with a neutral lettered fallback when there's no image or it fails to load. */
export function CoinImage({ src, symbol, size = 32 }: { src: string | null | undefined; symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { width: size, height: size };

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.4)) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] font-semibold uppercase text-[var(--muted)]"
      >
        {symbol.replace(/[^a-z0-9]/gi, "").charAt(0) || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party CDN logos, tiny and already sized
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      // An image that failed before hydration never fires onError — catch it on mount.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      style={style}
      className="shrink-0 rounded-full bg-[var(--surface-hover)] object-cover"
    />
  );
}

const trendColor = (values: number[]) => {
  const delta = values[values.length - 1] - values[0];
  if (Math.abs(delta) / values[0] < 0.0005) return "var(--muted)";
  return delta > 0 ? "var(--positive)" : "var(--negative)";
};

function linePath(values: number[], width: number, height: number, pad = 1.5) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = pad + (1 - (value - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Real hourly-close sparkline; renders nothing when there's no history. */
export function Sparkline({ values, width = 64, height = 20 }: { values: number[] | undefined; width?: number; height?: number }) {
  if (!values || values.length < 2) return null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0" aria-hidden="true">
      <path d={linePath(values, width, height)} fill="none" stroke={trendColor(values)} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Compact 24h line chart with high/low labels for the selected coin. */
export function PriceChart({ values, loading }: { values: number[] | undefined; loading: boolean }) {
  const width = 320;
  const height = 72;
  if (!values || values.length < 2) {
    return (
      <div className="flex h-[72px] items-center justify-center rounded-lg bg-[var(--surface-raised)] text-xs text-[var(--muted-dim)]">
        {loading ? <span className="pf-shimmer h-full w-full rounded-lg" /> : "No 24h price history for this coin yet"}
      </div>
    );
  }
  const path = linePath(values, width, height, 4);
  const color = trendColor(values);
  return (
    <figure className="m-0">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-[72px] w-full" role="img" aria-label="24 hour price chart">
          <path d={`${path} L${width},${height} L0,${height} Z`} fill={color} opacity="0.08" />
          <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--muted-dim)]">
        <span>24h ago</span>
        <span>
          L {usd(Math.min(...values))} · H {usd(Math.max(...values))}
        </span>
        <span>Now</span>
      </figcaption>
    </figure>
  );
}

/** Briefly returns "up"/"down" after `value` changes, for a subtle tint that never shifts layout. */
export function useFlash(value: number) {
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === previous.current) return;
    setFlash(value > previous.current ? "up" : "down");
    previous.current = value;
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [value]);
  return flash === "up" ? "pf-flash-up" : flash === "down" ? "pf-flash-down" : "";
}

// Client-side history cache shared by every component on the page, so the
// ticket chart and position sparklines don't each refetch the same coin.
const HISTORY_REFRESH_MS = 5 * 60_000;
const historyCache = new Map<string, { at: number; closes: number[] | null }>();

/** ~24h of hourly closes per address via POST /api/tokens/history; `cachedOnly` never costs upstream budget. */
export function useTokenHistory(addresses: string[], cachedOnly = false) {
  const key = Array.from(new Set(addresses.map((address) => address.toLowerCase()))).sort().join(",");
  const [, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = async () => {
      const wanted = key.split(",").filter((address) => {
        const cached = historyCache.get(address);
        return !cached || Date.now() - cached.at >= HISTORY_REFRESH_MS;
      });
      if (wanted.length === 0) return;
      setLoading(true);
      try {
        const res = await fetch("/api/tokens/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: wanted.slice(0, 30), cachedOnly }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { history: Record<string, number[]> };
        for (const address of wanted) {
          const closes = data.history[address] ?? null;
          // A cached-only miss isn't "no history" — let a later full request try.
          if (closes || !cachedOnly) historyCache.set(address, { at: Date.now(), closes });
        }
        if (!cancelled) setVersion((v) => v + 1);
      } catch {
        // Decoration only — charts just stay empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, cachedOnly]);

  const lookup = (address: string) => historyCache.get(address.toLowerCase())?.closes ?? undefined;
  return { lookup, loading };
}
