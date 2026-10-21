"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CoinImage, signed, usd } from "@/app/duel/portfolio/ui";
import { CloseIcon, VerifiedIcon } from "@/app/icons";
import { signedPct } from "@/app/lib/calls";
import { playedLabel } from "@/app/lib/playedLabel";
import { ARENA_GLYPHS, roundLength, tradeSideLabel, type TradeReceipt } from "@/app/lib/trades";

// Minute-granular wall clock for relative trade times ("2h ago"). 0 on the
// server — trade cards only render for composer posts, which are client-only.
const MINUTE = 60_000;
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, MINUTE / 2);
  return () => window.clearInterval(timer);
}
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
export const useMinuteNow = () => useSyncExternalStore(subscribeMinute, minuteNow, () => 0);

// Where a trade lives, so the card links back to its record.
export const TRADE_SOURCE: Record<TradeReceipt["source"], { label: string; href: string }> = {
  portfolio: { label: "24h Portfolio", href: "/duel/portfolio" },
  arena: { label: "Arena", href: "/profile" },
};

export const tradeTone = (trade: TradeReceipt) => (Math.abs(trade.roiPct) < 0.05 ? "flat" : trade.roiPct > 0 ? "up" : "down");

export function TradeCoin({ trade, size = 36 }: { trade: TradeReceipt; size?: number }) {
  const arena = ARENA_GLYPHS[trade.symbol];
  if (trade.source === "arena" && arena) {
    return (
      <span className="trade-coin" style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden="true">
        <span className={arena.className}>{arena.glyph}</span>
      </span>
    );
  }
  return <CoinImage src={trade.imageUrl} symbol={trade.symbol} size={size} />;
}

export function TradeSide({ trade }: { trade: TradeReceipt }) {
  const arrow = trade.position === "long" ? "↑ " : trade.position === "short" ? "↓ " : "";
  return (
    <span className="trade-side" data-position={trade.position}>
      {arrow}
      {tradeSideLabel(trade)}
    </span>
  );
}

// One of your trades attached to a post: coin + side, ROI as the hero with
// the Embers P&L under it, the prices (or the round's result), then a
// "Verified" footer linking back to where the trade lives. Green/red only
// for the P&L, like the feed's call cards. On a saved post every number is
// resolved from the DB when the page loads (lib/trades.ts tradeReceiptsFor);
// an open trade's live return sits beside `roiAtPost`, what it was when the
// omen was posted. `onRemove` = the composer preview.
export function TradeCard({ trade, onRemove }: { trade: TradeReceipt; onRemove?: () => void }) {
  const now = useMinuteNow();
  const source = TRADE_SOURCE[trade.source];
  const when = now > 0 ? playedLabel(trade.at, now) : null;
  const status = trade.open ? "Open" : trade.source === "arena" ? "Played" : "Closed";
  const arenaResult = trade.result === "won" ? "Won" : trade.result === "lost" ? "Lost" : "Tied";

  return (
    <div className="trade-card" data-tone={tradeTone(trade)} data-open={trade.open || undefined}>
      <div className="trade-card-head">
        <TradeCoin trade={trade} size={40} />
        <div className="trade-card-name">
          <span className="trade-card-asset">
            <strong>${trade.symbol}</strong>
            <TradeSide trade={trade} />
          </span>
          <span className="trade-card-sub">{trade.name}</span>
        </div>
        <div className="trade-card-roi">
          <strong>{signedPct(trade.roiPct)}</strong>
          <span data-sign={Math.sign(Math.round(trade.pnl))}>{signed(trade.pnl)} Embers</span>
        </div>
      </div>
      {trade.source === "portfolio" ? (
        <dl className="trade-card-prices">
          <div>
            <dt>Entry</dt>
            <dd>{trade.entryPrice === null ? "—" : usd(trade.entryPrice)}</dd>
          </div>
          <span className="trade-card-arrow" aria-hidden="true">→</span>
          <div>
            <dt>{trade.open ? "Now" : "Exit"}</dt>
            <dd>{trade.exitPrice === null ? "—" : usd(trade.exitPrice)}</dd>
          </div>
          {trade.roiAtPost !== undefined && (
            <div className="trade-card-posted">
              <dt>When posted</dt>
              <dd data-sign={Math.sign(Math.round(trade.roiAtPost * 10))}>{signedPct(trade.roiAtPost)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="trade-card-round">
          <span data-result={trade.result}>{arenaResult}</span> vs {trade.opponent ?? "Opponent"}
          {trade.roundSeconds ? ` · ${roundLength(trade.roundSeconds)} Pulse round` : ""}
        </p>
      )}
      <div className="trade-card-foot">
        <span className="trade-card-verified" title="From the author's own trade history — the numbers can't be typed in">
          <VerifiedIcon />
          Verified trade
        </span>
        <span className="trade-card-when">
          {trade.open && <span className="trade-card-live" aria-hidden="true" />}
          {status}
          {when && ` · ${when}`} ·{" "}
          <Link href={source.href} className="trade-card-source">
            {source.label}
          </Link>
        </span>
      </div>
      {onRemove && (
        <button type="button" className="trade-card-remove" aria-label="Remove trade" onClick={onRemove}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

// A saved post whose trade ref no longer resolves to its author's own trade
// (e.g. the position or match row is gone): no numbers, just the fact.
export function TradeUnavailable() {
  return (
    <p className="trade-card trade-card--unavailable" role="note">
      <VerifiedIcon />
      Trade unavailable — it&apos;s no longer in the author&apos;s trade history.
    </p>
  );
}
