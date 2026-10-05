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

/**
 * Owned-coin list: a search box and a sort picker over plain rows (no
 * sparklines) — same "filter the list, order freezes while you're reading
 * it" idiom as app/duel/portfolio/TokenExplorer.tsx, just simpler since the
 * source data is already local (no pagination, no trending/new fetch).
 */
export function CoinList({ coins, totalUsd, onSelect }: { coins: Coin[]; totalUsd: number; onSelect: (address: string) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("value");
  const trimmed = query.trim().toLowerCase();

  const filtered = trimmed
    ? coins.filter((coin) => coin.symbol.toLowerCase().includes(trimmed) || coin.name.toLowerCase().includes(trimmed))
    : coins;

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
  const viewKey = `${sort}|${trimmed}`;
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
    <div>
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
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="wd-list-sort" aria-label="Sort">
          {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>

      {displayed.length === 0 ? (
        <p className="wd-empty">{coins.length === 0 ? "No holdings on Base yet — deposit ETH or a Base token to see it here." : `No coins match "${query}".`}</p>
      ) : (
        <>
          <div className="wd-table-head" aria-hidden="true">
            <span>Asset</span>
            <span>Balance</span>
            <span className="wd-table-head-portfolio">Portfolio</span>
            <span>Price</span>
          </div>
          <ul className="wd-coin-list">
            {displayed.map((address) => {
              const coin = byAddress.get(address);
              if (!coin) return null;
              const sharePct = totalUsd > 0 ? ((coin.valueUsd ?? 0) / totalUsd) * 100 : 0;
              return <CoinRow key={address} coin={coin} sharePct={sharePct} onSelect={() => onSelect(address)} />;
            })}
          </ul>
        </>
      )}
    </div>
  );
}
