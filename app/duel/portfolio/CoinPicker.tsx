"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TokenSearchResult } from "./types";
import { CoinImage, Sparkline, changeColor, compactUsd, pct, useTokenHistory, usd } from "./ui";

const DEBOUNCE_MS = 300;

type SearchStatus = "idle" | "loading" | "done" | "error";

/**
 * Coin selector: a search combobox over /api/tokens/search (name, ticker or
 * contract address) plus, while not searching, a compact row of the coins
 * this session has traded followed by trending Base coins.
 */
export function CoinPicker({
  selected,
  onSelect,
  recentAddresses,
}: {
  selected: TokenSearchResult | null;
  onSelect: (token: TokenSearchResult) => void;
  recentAddresses: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data = (await res.json()) as { results: TokenSearchResult[] };
        setResults(data.results);
        setActive(0);
        setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const history = useTokenHistory(results.map((token) => token.address), true);

  const choose = (token: TokenSearchResult) => {
    onSelect(token);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    }
  };

  const showDropdown = open && trimmed.length > 0;

  return (
    <div ref={rootRef}>
      <div className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search Base coins
        </label>
        <SearchIcon />
        <input
          id={`${listId}-input`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Base coins"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showDropdown && results[active] ? `${listId}-opt-${active}` : undefined}
          className="min-h-11 w-full rounded-lg bg-[var(--field-bg)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none ring-1 ring-transparent transition placeholder:text-[var(--muted-dim)] hover:ring-[var(--line)] focus:ring-[var(--brand)]"
        />

        {showDropdown && (
          <div
            id={`${listId}-list`}
            role="listbox"
            aria-label="Search results"
            className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[min(380px,60vh)] overflow-y-auto overscroll-contain rounded-xl bg-[var(--surface-raised)] p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)]"
          >
            {trimmed.length < 2 && <DropdownNote>Keep typing — a name, ticker or 0x address</DropdownNote>}
            {status === "loading" && results.length === 0 && (
              <div className="space-y-1 p-1" aria-label="Searching">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="pf-shimmer h-12 rounded-lg" />
                ))}
              </div>
            )}
            {status === "error" && <DropdownNote tone="error">Search is unavailable right now. Try again in a moment.</DropdownNote>}
            {status === "done" && results.length === 0 && <DropdownNote>No Base coins match “{trimmed}”.</DropdownNote>}
            {results.map((token, i) => (
              <button
                key={token.address}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(token)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                  i === active ? "bg-[var(--surface-hover)]" : ""
                }`}
              >
                <CoinImage src={token.imageUrl} symbol={token.symbol} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-sm font-semibold text-[var(--text)]">{token.name}</span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{token.symbol}</span>
                  </span>
                  <span className="block truncate text-[11px] tabular-nums text-[var(--muted-dim)]">
                    {token.marketCapUsd ? `MC ${compactUsd(token.marketCapUsd)}` : `Liq ${compactUsd(token.liquidityUsd)}`}
                  </span>
                </span>
                <span className="hidden sm:block">
                  <Sparkline values={history.lookup(token.address)} width={56} height={20} />
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm tabular-nums text-[var(--text)]">{usd(token.priceUsd)}</span>
                  <span className="block text-[11px] tabular-nums" style={{ color: changeColor(token.change24h) }}>
                    {token.change24h === null ? "—" : pct(token.change24h)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {trimmed.length === 0 && <QuickPicks selected={selected} onSelect={choose} recentAddresses={recentAddresses} />}
    </div>
  );
}

function QuickPicks({
  selected,
  onSelect,
  recentAddresses,
}: {
  selected: TokenSearchResult | null;
  onSelect: (token: TokenSearchResult) => void;
  recentAddresses: string[];
}) {
  const [trending, setTrending] = useState<TokenSearchResult[] | null>(null);
  const [recent, setRecent] = useState<TokenSearchResult[]>([]);
  const recentKey = recentAddresses.slice(0, 8).join(",");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tokens/trending", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then((data: { results: TokenSearchResult[] }) => !cancelled && setTrending(data.results))
      .catch(() => !cancelled && setTrending([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!recentKey) {
      setRecent([]);
      return;
    }
    let cancelled = false;
    fetch("/api/tokens/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: recentKey.split(",") }),
    })
      .then((res) => (res.ok ? res.json() : { tokens: [] }))
      .then((data: { tokens?: TokenSearchResult[] }) => !cancelled && setRecent(data.tokens ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recentKey]);

  const seen = new Set(recent.map((token) => token.address));
  const picks = [...recent, ...(trending ?? []).filter((token) => !seen.has(token.address))];

  if (trending !== null && picks.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {recent.length > 0 ? "Your coins & trending" : "Trending on Base"}
      </p>
      <div className="pf-scroll-x -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {trending === null && picks.length === 0
          ? [0, 1, 2, 3].map((i) => <span key={i} className="pf-shimmer h-11 w-28 shrink-0 rounded-full" />)
          : picks.map((token) => {
              const isSelected = selected?.address === token.address;
              return (
                <button
                  key={token.address}
                  type="button"
                  onClick={() => onSelect(token)}
                  aria-pressed={isSelected}
                  className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-left transition focus-visible:outline-2 focus-visible:outline-[var(--brand)] ${
                    isSelected ? "bg-[var(--selected-bg)] ring-1 ring-[var(--brand)]" : "bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <CoinImage src={token.imageUrl} symbol={token.symbol} size={26} />
                  <span className="text-xs font-semibold text-[var(--text)]">{token.symbol}</span>
                  <span className="text-[11px] tabular-nums" style={{ color: changeColor(token.change24h, 1) }}>
                    {token.change24h === null ? "—" : pct(token.change24h, 1)}
                  </span>
                </button>
              );
            })}
      </div>
    </div>
  );
}

function DropdownNote({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p className={`px-3 py-3 text-xs ${tone === "error" ? "text-[var(--negative)]" : "text-[var(--muted)]"}`} role={tone === "error" ? "alert" : undefined}>
      {children}
    </p>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}
