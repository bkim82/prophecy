"use client";

import { useEffect, useMemo, useState } from "react";
import { CoinRow } from "./CoinRow";
import type { Coin } from "./types";

type Sort = "value" | "name" | "change";
const SORTS: { id: Sort; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "name", label: "Name" },
  { id: "change", label: "24h change" },
];

function sortKey(coin: Coin, sort: Sort): number | string {
  if (sort === "name") return coin.symbol.toLowerCase();
  if (sort === "change") return coin.change24h ?? -Infinity;
  return coin.valueUsd ?? 0;
}

// The search box only earns its space once the list is long.
const SEARCH_THRESHOLD = 6;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Holdings table (Asset / Price / Balance) — same "filter the list, order
 * freezes while you're reading it" idiom as app/duel/portfolio/TokenExplorer.tsx,
 * just simpler since the source data is already local (no pagination, no
 * trending/new fetch). Hidden coins (see ./hiddenCoins.ts) are left out unless
 * "Show hidden" is on, and never count toward the total in the header strip.
 */
export function CoinList({
  coins,
  isHidden,
  onToggleHidden,
  onSelect,
  onExplore,
}: {
  coins: Coin[];
  isHidden: (address: string) => boolean;
  onToggleHidden: (address: string) => void;
  onSelect: (address: string) => void;
  onExplore: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("value");
  const [showHidden, setShowHidden] = useState(false);
  const trimmed = query.trim().toLowerCase();

  const hiddenCount = coins.filter((coin) => isHidden(coin.address)).length;
  const totalUsd = coins.reduce((sum, coin) => sum + (isHidden(coin.address) ? 0 : coin.valueUsd ?? 0), 0);
  const filtered = coins.filter((coin) =>
    (showHidden || !isHidden(coin.address))
    && (!trimmed || coin.symbol.toLowerCase().includes(trimmed) || coin.name.toLowerCase().includes(trimmed)));

  const sortedIds = useMemo(() => {
    const factor = sort === "name" ? 1 : -1; // name: A→Z; value/change: high→low
    return [...filtered]
      .sort((a, b) => {
        const ak = sortKey(a, sort);
        const bk = sortKey(b, sort);
        return ak < bk ? -factor : ak > bk ? factor : 0;
      })
      .map((coin) => coin.address);
  }, [filtered, sort]);

  // Frozen ordering: re-rank only when the view (sort/search) or the coin set
  // changes, never on a plain price tick — same principle as TokenExplorer's.
  const viewKey = `${sort}|${trimmed}|${showHidden}`;
  const [frozen, setFrozen] = useState<{ key: string; order: string[] }>({ key: "", order: [] });
  const displayed = useMemo(() => {
    if (frozen.key !== viewKey) return sortedIds;
    const members = new Set(sortedIds);
    const kept = frozen.order.filter((id) => members.has(id));
    const keptSet = new Set(kept);
    return [...kept, ...sortedIds.filter((id) => !keptSet.has(id))];
  }, [frozen, viewKey, sortedIds]);
  useEffect(() => {
    if (displayed.length === 0) return;
    if (frozen.key !== viewKey || displayed.length !== frozen.order.length || displayed.some((id, i) => frozen.order[i] !== id)) {
      setFrozen({ key: viewKey, order: displayed });
    }
  }, [displayed, frozen, viewKey]);

  const byAddress = new Map(coins.map((coin) => [coin.address, coin]));

  return (
    <>
      <div className="wd-card wd-holdings">
        {coins.length > 0 && (
          <div className="wd-holdings-bar">
            <div className="wd-holdings-total">
              <span>Total</span>
              <strong>{usd(totalUsd)}</strong>
              <small>{coins.length - hiddenCount} {coins.length - hiddenCount === 1 ? "token" : "tokens"}</small>
            </div>
            <label className="wd-list-sort-field">
              <span>Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="wd-list-sort">
                {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {coins.length > SEARCH_THRESHOLD && (
          <div className="wd-list-controls">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter your coins"
              aria-label="Filter your coins"
              spellCheck={false}
              className="wd-list-search"
            />
          </div>
        )}

        {displayed.length === 0 ? (
          <p className="wd-card-empty">
            {coins.length === 0
              ? <>No tokens yet. Use your cash to buy one. <button type="button" className="wd-text-link" onClick={onExplore}>Explore tokens</button></>
              : trimmed
                ? `No coins match "${query}".`
                : "All your coins are hidden."}
          </p>
        ) : (
          <>
            <div className="wd-table-head" aria-hidden="true">
              <span>Asset</span>
              <span>Price</span>
              <span>Balance</span>
            </div>
            <ul className="wd-coin-list">
              {displayed.map((address) => {
                const coin = byAddress.get(address);
                if (!coin) return null;
                return (
                  <CoinRow
                    key={address}
                    coin={coin}
                    hidden={isHidden(address)}
                    onSelect={() => onSelect(address)}
                    onToggleHidden={() => onToggleHidden(address)}
                  />
                );
              })}
            </ul>
          </>
        )}
      </div>

      {hiddenCount > 0 && (
        <button type="button" className="wd-list-hidden-toggle" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? "Hide hidden coins" : `Show hidden (${hiddenCount})`}
        </button>
      )}
    </>
  );
}
