"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TokenSearchResult } from "./types";
import { Change, CoinImage, LivePrice, StarButton, compactOrDash } from "./ui";
import { useWatchlist, type WatchItem } from "./watchlist";

const DEBOUNCE_MS = 300;
const PRICE_REFRESH_MS = 20_000;
const STALE_RANKING_MS = 3 * 60_000;

type Filter = "trending" | "watchlist" | "new" | "all";
type Sort = "rank" | "volume" | "mcap" | "gainers" | "losers";
type PoolList = "trending" | "new";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "watchlist", label: "Watchlist" },
  { id: "new", label: "New" },
  { id: "all", label: "All" },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "volume", label: "24h volume" },
  { id: "mcap", label: "Market cap" },
  { id: "gainers", label: "24h gainers" },
  { id: "losers", label: "24h losers" },
];

const placeholder = (item: WatchItem): TokenSearchResult => ({
  ...item,
  priceUsd: 0,
  liquidityUsd: 0,
  change24h: null,
  marketCapUsd: null,
  pairAddress: null,
  volume24hUsd: null,
  pairCreatedAt: null,
  dexId: null,
  quoteSymbol: null,
});

/** Higher sorts first; null always last. */
function sortKey(token: TokenSearchResult | undefined, sort: Sort): number | null {
  if (!token) return null;
  switch (sort) {
    case "volume":
      return token.volume24hUsd;
    case "mcap":
      return token.marketCapUsd;
    case "gainers":
      return token.change24h;
    case "losers":
      return token.change24h === null ? null : -token.change24h;
    default:
      return null;
  }
}

function rankIds(ids: string[], sort: Sort, tokens: Map<string, TokenSearchResult>) {
  if (sort === "rank") return ids;
  return ids
    .map((id, i) => ({ id, i, key: sortKey(tokens.get(id), sort) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? a.i - b.i : 1) : -1;
      return b.key - a.key || a.i - b.i;
    })
    .map((entry) => entry.id);
}

async function fetchTokens(url: string, init?: RequestInit): Promise<TokenSearchResult[]> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { results?: TokenSearchResult[]; tokens?: TokenSearchResult[] };
  return data.results ?? data.tokens ?? [];
}

export type TokenExplorerEndpoints = { trending: string; new: string; search: string; prices: string };
const DEFAULT_ENDPOINTS: TokenExplorerEndpoints = {
  trending: "/api/tokens/trending",
  new: "/api/tokens/new",
  search: "/api/tokens/search",
  prices: "/api/tokens/prices",
};

/**
 * Token discovery column: always-visible search (name, ticker or 0x address),
 * Trending · Watchlist · New · All filters, sorting, and scannable rows.
 * Prices refresh in place, but the order is frozen while browsing — a
 * "Refresh rankings" control re-sorts (and refetches the lists) on demand.
 *
 * `endpoints` defaults to the Clerk-gated /api/tokens/* routes this component
 * was built for; the wallet's Advanced tab (no Clerk sign-in) passes the
 * no-auth /api/wallet/* mirrors instead (see docs/wallet.md) — same lib
 * functions underneath, just without the auth() gate.
 */
export function TokenExplorer({
  selected,
  onSelect,
  onAutoSelect,
  ownedAddresses,
  endpoints = DEFAULT_ENDPOINTS,
}: {
  selected: TokenSearchResult | null;
  onSelect: (token: TokenSearchResult) => void;
  /** First load picks a token so the detail column isn't empty; must not navigate on mobile. */
  onAutoSelect: (token: TokenSearchResult) => void;
  ownedAddresses: string[];
  endpoints?: TokenExplorerEndpoints;
}) {
  const fetchPrices = useCallback(
    (addresses: string[]) =>
      fetchTokens(endpoints.prices, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      }),
    [endpoints.prices],
  );
  const watch = useWatchlist();
  const [filter, setFilter] = useState<Filter>("trending");
  const [sort, setSort] = useState<Sort>("rank");
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState<Map<string, TokenSearchResult>>(() => new Map());
  const [lists, setLists] = useState<Record<PoolList, string[] | null>>({ trending: null, new: null });
  const [listsAt, setListsAt] = useState(() => Date.now());
  const [search, setSearch] = useState<{ query: string; status: "loading" | "done" | "error"; ids: string[] } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const inputId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  const merge = useCallback((fresh: TokenSearchResult[]) => {
    if (fresh.length === 0) return;
    setTokens((prev) => {
      const next = new Map(prev);
      for (const token of fresh) next.set(token.address, { ...prev.get(token.address), ...token });
      return next;
    });
  }, []);

  const loadList = useCallback(
    async (list: PoolList) => {
      try {
        const results = await fetchTokens(endpoints[list]);
        merge(results);
        setLists((prev) => ({ ...prev, [list]: results.map((token) => token.address) }));
      } catch {
        setLists((prev) => ({ ...prev, [list]: prev[list] ?? [] }));
      }
    },
    [merge, endpoints],
  );

  // Trending loads up front; New only once someone asks for it (it costs upstream budget).
  useEffect(() => {
    loadList("trending");
  }, [loadList]);
  useEffect(() => {
    if ((filter === "new" || filter === "all") && lists.new === null) loadList("new");
  }, [filter, lists.new, loadList]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Search (debounced).
  useEffect(() => {
    if (!searching) {
      setSearch(null);
      return;
    }
    let cancelled = false;
    setSearch((prev) => ({ query: trimmed, status: "loading", ids: prev?.ids ?? [] }));
    const timer = setTimeout(async () => {
      try {
        const results = await fetchTokens(`${endpoints.search}?q=${encodeURIComponent(trimmed)}`);
        if (cancelled) return;
        merge(results);
        setSearch({ query: trimmed, status: "done", ids: results.map((token) => token.address) });
      } catch {
        if (!cancelled) setSearch({ query: trimmed, status: "error", ids: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, searching, merge, endpoints.search]);

  const watchKey = watch.list.map((item) => item.address).join(",");
  const ownedKey = ownedAddresses.join(",");
  const ids = useMemo(() => {
    const watchIds = watchKey ? watchKey.split(",") : [];
    if (searching) return search?.ids ?? [];
    if (filter === "trending") return lists.trending ?? [];
    if (filter === "new") return lists.new ?? [];
    if (filter === "watchlist") return watchIds;
    const ownedIds = ownedKey ? ownedKey.split(",") : [];
    return Array.from(new Set([...ownedIds, ...watchIds, ...(lists.trending ?? []), ...(lists.new ?? [])]));
  }, [searching, search, filter, lists, watchKey, ownedKey]);

  // Live prices for whatever is listed, in place — values change, order doesn't.
  const idsKey = ids.slice(0, 30).join(",");
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const fresh = await fetchPrices(idsKey.split(","));
        if (!cancelled) merge(fresh);
      } catch {
        // Keep the last values.
      }
    };
    // Rows we've never priced (watchlist/owned) get filled right away.
    if (idsKey.split(",").some((id) => !tokensRef.current.has(id))) refresh();
    const id = setInterval(refresh, PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [idsKey, merge, fetchPrices]);

  // Frozen ordering: re-rank only when the view (filter/sort/search) changes or on "Refresh rankings".
  const viewKey = `${searching ? `search:${search?.query ?? ""}` : filter}|${sort}`;
  const ranked = useMemo(() => rankIds(ids, sort, tokens), [ids, sort, tokens]);
  const [frozen, setFrozen] = useState<{ key: string; order: string[] }>({ key: "", order: [] });
  const displayed = useMemo(() => {
    if (frozen.key !== viewKey) return ranked;
    const members = new Set(ids);
    const kept = frozen.order.filter((id) => members.has(id));
    const keptSet = new Set(kept);
    return [...kept, ...ranked.filter((id) => !keptSet.has(id))]; // newly added rows join at the bottom
  }, [frozen, viewKey, ranked, ids]);
  useEffect(() => {
    if (displayed.length === 0) return;
    if (frozen.key !== viewKey || displayed.length !== frozen.order.length || displayed.some((id, i) => frozen.order[i] !== id)) {
      setFrozen({ key: viewKey, order: displayed });
    }
  }, [displayed, frozen, viewKey]);

  const rankingsChanged = displayed.join(",") !== ranked.join(",");
  const rankingsOld = !searching && nowTick - listsAt >= STALE_RANKING_MS;
  const [refreshing, setRefreshing] = useState(false);
  const refreshRankings = async () => {
    setRefreshing(true);
    const pending: Promise<unknown>[] = [];
    if (!searching) {
      if (filter === "trending" || filter === "all") pending.push(loadList("trending"));
      if (filter === "new" || filter === "all") pending.push(loadList("new"));
    }
    if (idsKey) pending.push(fetchPrices(idsKey.split(",")).then(merge, () => {}));
    await Promise.all(pending);
    setListsAt(Date.now());
    setNowTick(Date.now());
    setFrozen({ key: "", order: [] }); // next render re-ranks from fresh data
    setRefreshing(false);
  };

  const tokenFor = (id: string) => {
    const token = tokens.get(id);
    if (token) return token;
    const item = watch.list.find((entry) => entry.address === id);
    return item ? placeholder(item) : null;
  };

  // Fill the detail column on first load (desktop shows it; mobile ignores it).
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || selected || searching || filter !== "trending") return;
    const first = displayed[0] && tokens.get(displayed[0]);
    if (first) {
      autoSelected.current = true;
      onAutoSelect(first);
    }
  }, [displayed, tokens, selected, searching, filter, onAutoSelect]);

  // Selection indicator slides between rows instead of jumping.
  const [indicator, setIndicator] = useState<{ top: number; height: number; visible: boolean; animate: boolean }>({
    top: 0,
    height: 0,
    visible: false,
    animate: false,
  });
  const selectedAddress = selected?.address ?? null;
  useLayoutEffect(() => {
    const row = selectedAddress ? listRef.current?.querySelector<HTMLElement>(`[data-address="${selectedAddress}"]`) : null;
    setIndicator((prev) =>
      row
        ? { top: row.offsetTop, height: row.offsetHeight, visible: true, animate: prev.visible }
        : { ...prev, visible: false, animate: false },
    );
  }, [selectedAddress, displayed]);

  const focusRow = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row-select]");
    if (!buttons || buttons.length === 0) return;
    buttons[Math.max(0, Math.min(buttons.length - 1, index))].focus();
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row-select]") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else focusRow(index - 1);
    } else if (event.key === "Escape") {
      searchRef.current?.focus();
    }
  };

  const owned = new Set(ownedAddresses);
  const listPending = filter === "new" ? lists.new === null : filter !== "watchlist" && lists.trending === null;
  const loading = ids.length === 0 && (searching ? search?.status === "loading" : listPending);

  return (
    <section className="flex min-h-0 flex-col rounded-xl bg-[var(--surface)] max-lg:h-[min(780px,calc(100vh-150px))] lg:absolute lg:inset-0" aria-label="Explore tokens">
      <div className="space-y-2.5 p-3 pb-2">
        <div className="relative">
          <label htmlFor={inputId} className="sr-only">
            Search Base coins by name, ticker or contract address
          </label>
          <SearchIcon />
          <input
            ref={searchRef}
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Name, ticker or 0x address"
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-lg bg-[var(--field-bg)] py-2.5 pl-10 pr-3 text-sm text-[var(--text)] outline-none ring-1 ring-transparent transition placeholder:text-[var(--muted-dim)] hover:ring-[var(--line)] focus:ring-[var(--brand)]"
          />
        </div>

        {searching ? (
          <div className="flex min-h-8 items-center justify-between gap-2 text-xs">
            <span className="truncate text-[var(--muted)]">
              Results for <span className="text-[var(--text)]">“{trimmed}”</span>
            </span>
            <button type="button" onClick={() => setQuery("")} className="shrink-0 rounded-md px-2 py-1 font-semibold text-[var(--brand-strong)] hover:bg-[var(--surface-hover)]">
              Clear
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-[var(--field-bg)] p-1" role="group" aria-label="Filter tokens">
            {FILTERS.map((option, i) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={`relative min-h-8 rounded-md px-1 text-xs font-semibold transition ${
                  filter === option.id ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                } ${
                  // Divider between segments; hidden next to the selected pill so it doesn't double up.
                  i > 0 && filter !== option.id && filter !== FILTERS[i - 1].id
                    ? "before:absolute before:-left-[2.5px] before:top-2 before:bottom-2 before:w-px before:bg-[var(--line)]"
                    : ""
                }`}
              >
                {option.label}
                {option.id === "watchlist" && watch.list.length > 0 && <span className="ml-1 text-[var(--muted-dim)]">{watch.list.length}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="min-h-8 min-w-0 rounded-md bg-[var(--field-bg)] px-2 text-xs font-semibold text-[var(--text)] outline-none ring-1 ring-transparent hover:ring-[var(--line)] focus:ring-[var(--brand)]"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refreshRankings}
            disabled={refreshing}
            className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-60"
          >
            {(rankingsChanged || rankingsOld) && !refreshing && <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" aria-hidden="true" />}
            <RefreshIcon spinning={refreshing} />
            {refreshing ? "Refreshing…" : "Refresh rankings"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {loading ? (
          <div className="space-y-1 px-1.5" aria-label="Loading tokens">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="pf-shimmer h-14 rounded-lg" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <EmptyNote>
            {searching
              ? search?.status === "error"
                ? "Search is unavailable right now. Try again in a moment."
                : search?.status === "done"
                  ? `No Base coins match “${trimmed}”.`
                  : "Searching…"
              : filter === "watchlist"
                ? "Star a token to keep it here. Watching never places a trade."
                : filter === "new"
                  ? "No new Base pools with real liquidity right now."
                  : "Token lists are unavailable right now. Try Refresh rankings."}
          </EmptyNote>
        ) : (
          <ul ref={listRef} className="relative" onKeyDown={onListKeyDown} aria-label="Tokens">
            <span
              aria-hidden="true"
              className={`pf-select-indicator pointer-events-none absolute inset-x-0 top-0 rounded-lg ${indicator.animate ? "is-animated" : ""}`}
              style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height, opacity: indicator.visible ? 1 : 0 }}
            />
            {displayed.map((id) => {
              const token = tokenFor(id);
              if (!token) return null;
              return (
                <TokenRow
                  key={id}
                  token={token}
                  selected={selectedAddress === id}
                  owned={owned.has(id)}
                  watched={watch.has(id)}
                  onSelect={() => onSelect(selectedAddress === id && selected ? selected : token)}
                  onToggleWatch={() => watch.toggle(token)}
                />
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function TokenRow({
  token,
  selected,
  owned,
  watched,
  onSelect,
  onToggleWatch,
}: {
  token: TokenSearchResult;
  selected: boolean;
  owned: boolean;
  watched: boolean;
  onSelect: () => void;
  onToggleWatch: () => void;
}) {
  const stats = [token.marketCapUsd ? `MC ${compactOrDash(token.marketCapUsd)}` : null, token.liquidityUsd > 0 ? `Liq ${compactOrDash(token.liquidityUsd)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li data-address={token.address} className="pf-row relative">
      <button
        type="button"
        data-row-select
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="relative flex w-full items-center gap-2.5 rounded-lg py-2 pl-3 pr-10 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand)]"
      >
        <CoinImage src={token.imageUrl} symbol={token.symbol} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold text-[var(--text)]">{token.name}</span>
            <span className="shrink-0 text-xs text-[var(--muted)]">{token.symbol}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {owned && (
              <span className="shrink-0 rounded bg-[var(--selected-bg)] px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-[var(--brand-strong)]">Owned</span>
            )}
            <span className="truncate text-[11px] tabular-nums text-[var(--muted-dim)]">{stats || "No market data yet"}</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm text-[var(--text)]">
            {token.priceUsd > 0 ? <LivePrice value={token.priceUsd} /> : <span className="text-[var(--muted-dim)]">—</span>}
          </span>
          <Change value={token.change24h} label="24h" className="text-[11px]" />
        </span>
      </button>
      <StarButton on={watched} onToggle={onToggleWatch} label={token.symbol} className="pf-row-star absolute right-1 top-1/2 -translate-y-1/2" />
    </li>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-xs text-[var(--muted)]">{children}</p>;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${spinning ? "pf-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" strokeLinejoin="round" />
    </svg>
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
