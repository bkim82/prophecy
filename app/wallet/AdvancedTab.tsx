"use client";

import { useCallback, useRef, useState } from "react";
import { TokenExplorer } from "@/app/duel/portfolio/TokenExplorer";
import type { TokenSearchResult } from "@/lib/basePrices";
import { AdvancedTokenDetail } from "./AdvancedTokenDetail";
import type { Coin } from "./types";

const WALLET_EXPLORER_ENDPOINTS = {
  trending: "/api/wallet/trending",
  new: "/api/wallet/new",
  search: "/api/wallet/search",
  prices: "/api/wallet/prices",
};

type MobileView = "explore" | "detail";

/**
 * "Buy" tab: a TokenExplorer (Trending/Watchlist/New/All, same component the
 * 24h Portfolio game uses, pointed at the no-auth /api/wallet/* mirrors) next
 * to a detail panel with Buy/Sell — the look of the portfolio game's
 * explore+detail layout, without the 24h session/stake/P&L (see docs/wallet.md).
 */
export function AdvancedTab({
  coins,
  onBuy,
  onSell,
}: {
  coins: Coin[];
  onBuy: (token: { address: string; symbol: string }) => void;
  onSell: (token: { address: string; symbol: string }) => void;
}) {
  const [selected, setSelected] = useState<TokenSearchResult | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("explore");
  const autoSelected = useRef(false);

  const ownedAddresses = coins.map((coin) => coin.address).filter((address) => address !== "eth");
  const ownedQty = selected ? (coins.find((coin) => coin.address === selected.address)?.qty ?? null) : null;

  const selectToken = (token: TokenSearchResult) => {
    setSelected(token);
    setMobileView("detail");
  };
  const autoSelectToken = (token: TokenSearchResult) => {
    if (autoSelected.current) return;
    autoSelected.current = true;
    setSelected(token);
  };
  const applyQuote = useCallback(
    (fresh: TokenSearchResult) => setSelected((prev) => (prev && prev.address === fresh.address ? fresh : prev)),
    [],
  );

  const tab = (view: MobileView) => (mobileView === view ? "" : "max-lg:hidden");

  return (
    <div className="wd-advanced">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,36fr)_minmax(0,64fr)]">
        <div className={`lg:relative ${tab("explore")}`}>
          <TokenExplorer
            selected={selected}
            onSelect={selectToken}
            onAutoSelect={autoSelectToken}
            ownedAddresses={ownedAddresses}
            endpoints={WALLET_EXPLORER_ENDPOINTS}
          />
        </div>
        <div className={tab("detail")}>
          <AdvancedTokenDetail
            token={selected}
            onQuote={applyQuote}
            ownedQty={ownedQty}
            now={Date.now()}
            onBack={() => setMobileView("explore")}
            onBuy={() => selected && onBuy(selected)}
            onSell={() => selected && onSell(selected)}
          />
        </div>
      </div>
    </div>
  );
}
