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

export type ChartPeriod = "1h" | "24h" | "7d" | "30d";
export const CHART_PERIODS: ChartPeriod[] = ["1h", "24h", "7d", "30d"];

/**
 * Signed percent change with an arrow, so a falling coin reads as clearly as
 * a rising one even without color. `label` (e.g. "24h") is shown muted in front.
 */
export function Change({ value, label, digits = 1, className = "" }: { value: number | null; label?: string; digits?: number; className?: string }) {
  const flat = value === null || Number(Math.abs(value).toFixed(digits)) === 0;
  const arrow = flat ? "" : value! > 0 ? "▲" : "▼";
  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums ${className}`}>
      {label && <span className="text-[var(--muted-dim)]">{label}</span>}
      <span style={{ color: changeColor(value, digits) }}>
        {value === null ? (
          "—"
        ) : (
          <>
            {arrow && (
              <span aria-hidden="true" className="mr-0.5 text-[0.8em]">
                {arrow}
              </span>
            )}
            {pct(value, digits)}
          </>
        )}
      </span>
    </span>
  );
}

/**
 * A price whose changed digits briefly tint up/down on each update. Digits are
 * tabular, so the number's width never jumps as it ticks.
 */
export function LivePrice({ value, className = "" }: { value: number; className?: string }) {
  const text = usd(value);
  const previous = useRef({ text, value });
  const [change, setChange] = useState<{ from: number; dir: "up" | "down"; key: number } | null>(null);

  useEffect(() => {
    const prev = previous.current;
    if (prev.text === text) return;
    let from = 0;
    while (from < text.length && text[from] === prev.text[from]) from++;
    previous.current = { text, value };
    if (prev.value <= 0 || value <= 0) return;
    setChange({ from, dir: value > prev.value ? "up" : "down", key: Date.now() });
    const id = setTimeout(() => setChange(null), 900);
    return () => clearTimeout(id);
  }, [text, value]);

  return (
    <span className={`tabular-nums ${className}`} aria-label={text}>
      {text.split("").map((char, i) => {
        const tinted = change !== null && i >= change.from && /\d/.test(char);
        return (
          <span key={tinted ? `${i}-${change.key}` : i} aria-hidden="true" className={tinted ? `pf-digit-${change.dir}` : undefined}>
            {char}
          </span>
        );
      })}
    </span>
  );
}

/** Watchlist toggle; filling the star plays a small spring pop. */
export function StarButton({ on, onToggle, label, className = "" }: { on: boolean; onToggle: () => void; label: string; className?: string }) {
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      onClick={(event) => {
        event.stopPropagation();
        if (!on) setPop((n) => n + 1);
        onToggle();
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] ${
        on ? "text-[var(--ember)]" : "text-[var(--muted-dim)] hover:text-[var(--text)]"
      } ${className}`}
    >
      <svg key={pop} viewBox="0 0 16 16" className={`h-4 w-4 ${pop > 0 && on ? "pf-star-pop" : ""}`} aria-hidden="true">
        <path
          d="M8 1.75l1.86 3.9 4.27.52-3.14 2.94.8 4.23L8 11.27l-3.79 2.07.8-4.23L1.87 6.17l4.27-.52z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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
// detail chart doesn't refetch a coin/period it already has. Keyed `${period}:${address}`.
// `retry` = the server couldn't fetch it yet (upstream budget/rate limit), as
// opposed to a coin that genuinely has no history. `dueAt` = when to ask again.
const HISTORY_REFRESH_MS = 5 * 60_000;
const HISTORY_RETRY_MS = 15_000; // fallback when the server can't say when (upstream failure)
const HISTORY_TICK_MS = 1_000;
const historyCache = new Map<string, { at: number; closes: number[] | null; retry: boolean; dueAt: number }>();

export type HistoryStatus = "ready" | "loading" | "none";

/** Closes per address via POST /api/tokens/history (24h hourly by default); `cachedOnly` never costs upstream budget. */
export function useTokenHistory(addresses: string[], cachedOnly = false, period: ChartPeriod = "24h") {
  const key = Array.from(new Set(addresses.map((address) => address.toLowerCase()))).sort().join(",");
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let busy = false;
    const load = async () => {
      if (busy) return;
      const now = Date.now();
      const wanted = key.split(",").filter((address) => {
        const cached = historyCache.get(`${period}:${address}`);
        return !cached || now >= cached.dueAt;
      });
      if (wanted.length === 0) return;
      busy = true;
      const markRetry = (address: string, delayMs = HISTORY_RETRY_MS) => {
        const previous = historyCache.get(`${period}:${address}`);
        const at = Date.now();
        historyCache.set(`${period}:${address}`, { at, closes: previous?.closes ?? null, retry: !previous?.closes, dueAt: at + delayMs });
      };
      const markFetched = (address: string, closes: number[] | null) => {
        const at = Date.now();
        historyCache.set(`${period}:${address}`, { at, closes, retry: false, dueAt: at + HISTORY_REFRESH_MS });
      };
      try {
        const res = await fetch("/api/tokens/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: wanted.slice(0, 30), cachedOnly, period }),
        });
        if (!res.ok) {
          wanted.forEach(markRetry);
          return;
        }
        const data = (await res.json()) as { history: Record<string, number[]>; retry?: string[]; retryAfterMs?: number | null };
        const retry = new Set(data.retry ?? []);
        // Budget spent → ask right as the next slot frees (jittered so viewers don't stampede it).
        const retryDelay = data.retryAfterMs ? data.retryAfterMs + 250 + Math.random() * 750 : HISTORY_RETRY_MS;
        for (const address of wanted) {
          const closes = data.history[address];
          if (closes) markFetched(address, closes);
          else if (retry.has(address)) markRetry(address, retryDelay);
          // A cached-only miss isn't "no history" — let a later full request try.
          else if (!cachedOnly) markFetched(address, null);
        }
      } catch {
        wanted.forEach(markRetry);
      } finally {
        busy = false;
        if (!cancelled) setVersion((v) => v + 1);
      }
    };
    load();
    // Cheap tick: only fetches what's due (retries when the server's budget frees, fresh data every 5 min).
    const id = setInterval(load, HISTORY_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, cachedOnly, period]);

  const entry = (address: string) => historyCache.get(`${period}:${address.toLowerCase()}`);
  const lookup = (address: string) => entry(address)?.closes ?? undefined;
  /** "none" only when the server says this coin has no history — never for a pending or failed fetch. */
  const status = (address: string): HistoryStatus => {
    const cached = entry(address);
    if (cached?.closes) return "ready";
    return cached && !cached.retry ? "none" : "loading";
  };
  return { lookup, status };
}

/** "$1.2M"-style figure, or an em dash when unknown. */
export const compactOrDash = (n: number | null | undefined) => (n && n > 0 ? compactUsd(n) : "—");

/** "45m", "5h", "3d", "4mo" — coarse age for pool creation times. */
export const ageLabel = (since: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months}mo` : `${Math.floor(months / 12)}y`;
};
