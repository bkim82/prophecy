"use client";

import { useRef, useState } from "react";
import { CoinImage, Change, usd as formatUnitPrice, useFlash } from "@/app/duel/portfolio/ui";
import { coinAccent, type Coin } from "./types";

const qty = (n: number) => (n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** One owned coin as a table row (Asset / Balance / Portfolio / Price), Coinbase Wallet home style, with a ⋯ menu to hide/unhide it. */
export function CoinRow({
  coin,
  sharePct,
  hidden,
  onSelect,
  onToggleHidden,
}: {
  coin: Coin;
  /** null for a hidden coin — it isn't part of the total. */
  sharePct: number | null;
  hidden: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
}) {
  const accent = coinAccent(coin.symbol);
  const flash = useFlash(coin.valueUsd ?? 0);

  return (
    <li className={`wd-coin-row ${flash}${hidden ? " is-hidden" : ""}`} style={{ "--wd-accent": accent } as React.CSSProperties}>
      <button type="button" onClick={onSelect} className="wd-coin-row-grid">
        <span className="wd-coin-row-asset">
          <CoinImage src={coin.imageUrl} symbol={coin.symbol} size={32} />
          <span className="wd-coin-row-identity">
            <strong>{coin.name}</strong>
            <small>{coin.symbol}{hidden ? " · Hidden" : ""}</small>
          </span>
        </span>
        <span className="wd-coin-row-balance">
          <span className="tabular-nums">{coin.valueUsd != null ? usd(coin.valueUsd) : "—"}</span>
          <small className="tabular-nums">{qty(coin.qty)} {coin.symbol}</small>
        </span>
        <span className="wd-coin-row-share tabular-nums">{coin.valueUsd && sharePct != null ? `${Math.round(sharePct)}%` : "—"}</span>
        <span className="wd-coin-row-price">
          <span className="tabular-nums">{coin.priceUsd != null ? formatUnitPrice(coin.priceUsd) : "—"}</span>
          <Change value={coin.change24h} digits={2} className="text-[11px]" />
        </span>
      </button>
      <CoinRowMenu symbol={coin.symbol} hidden={hidden} onToggleHidden={onToggleHidden} />
    </li>
  );
}

// Same open/blur/Escape handling as app/PostMenu.tsx, reusing its dropdown styles.
function CoinRowMenu({ symbol, hidden, onToggleHidden }: { symbol: string; hidden: boolean; onToggleHidden: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  return (
    <div
      className="post-menu wd-coin-row-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="post-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${symbol} actions`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className="post-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onToggleHidden();
            }}
          >
            {hidden ? `Unhide ${symbol}` : `Hide ${symbol}`}
          </button>
        </div>
      )}
    </div>
  );
}
