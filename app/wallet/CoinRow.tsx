"use client";

import { CoinImage, Change, usd as formatUnitPrice, useFlash } from "@/app/duel/portfolio/ui";
import { coinAccent, type Coin } from "./types";

const qty = (n: number) => (n === 0 ? "0" : n < 0.0001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** One owned coin as a table row (Asset / Balance / Portfolio / Price), Coinbase Wallet home style. */
export function CoinRow({ coin, sharePct, onSelect }: { coin: Coin; sharePct: number; onSelect: () => void }) {
  const accent = coinAccent(coin.symbol);
  const flash = useFlash(coin.valueUsd ?? 0);

  return (
    <li className={`wd-coin-row ${flash}`} style={{ "--wd-accent": accent } as React.CSSProperties}>
      <button type="button" onClick={onSelect} className="wd-coin-row-grid">
        <span className="wd-coin-row-asset">
          <CoinImage src={coin.imageUrl} symbol={coin.symbol} size={32} />
          <span className="wd-coin-row-identity">
            <strong>{coin.name}</strong>
            <small>{coin.symbol}</small>
          </span>
        </span>
        <span className="wd-coin-row-balance">
          <span className="tabular-nums">{coin.valueUsd != null ? usd(coin.valueUsd) : "—"}</span>
          <small className="tabular-nums">{qty(coin.qty)} {coin.symbol}</small>
        </span>
        <span className="wd-coin-row-share tabular-nums">{coin.valueUsd ? `${Math.round(sharePct)}%` : "—"}</span>
        <span className="wd-coin-row-price">
          <span className="tabular-nums">{coin.priceUsd != null ? formatUnitPrice(coin.priceUsd) : "—"}</span>
          <Change value={coin.change24h} digits={2} className="text-[11px]" />
        </span>
      </button>
    </li>
  );
}
