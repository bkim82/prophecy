"use client";

import { useState } from "react";
import { ROOM_COINS, coinMeta, type RoomCoin, type RoomSide } from "@/app/lib/roomsMocks";

export type RoomEvent = {
  id: string;
  t: number;
  who: string; // "You" for your own trades
  coin: RoomCoin;
  kind: "open" | "close";
  side: RoomSide;
  stake: number;
  leverage: number;
  price: number;
  pnl?: number; // closes only
};

type Filter = RoomCoin | "all";

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const signedUsd = (n: number) =>
  `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatPrice = (p: number) =>
  p.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: p < 1 ? 5 : 2, maximumFractionDigits: p < 1 ? 5 : 2 });

export const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
};

/** Live trade tape for everyone in your rank's room, filterable by coin. */
export function RoomFeed({ events, now }: { events: RoomEvent[]; now: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? events : events.filter((e) => e.coin === filter);

  return (
    <section className="panel oracle-feed" aria-label="Room activity">
      <header className="oracle-panel-head">
        <h2 className="display-font">Signs in the room</h2>
        <span className="oracle-live"><span className="oracle-live-dot" aria-hidden="true" />live</span>
      </header>
      <div className="oracle-filters" role="group" aria-label="Filter by coin">
        <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All
        </button>
        {ROOM_COINS.map((c) => (
          <button
            key={c.id}
            type="button"
            data-market={c.market}
            className={filter === c.id ? "active" : ""}
            aria-pressed={filter === c.id}
            onClick={() => setFilter(c.id)}
          >
            <span className={`market-symbol ${c.symbolClass}`} aria-hidden="true">{c.symbol}</span>
            {c.ticker}
          </button>
        ))}
      </div>
      <ol className="oracle-feed-list" aria-live="polite">
        {shown.length === 0 && <li className="oracle-feed-empty">The room is quiet. Watching for signs…</li>}
        {shown.map((e) => {
          const meta = coinMeta(e.coin);
          const self = e.who === "You";
          return (
            <li key={e.id} className={`oracle-feed-row${self ? " is-self" : ""}`} data-market={meta.market}>
              <span className="oracle-feed-avatar" aria-hidden="true">{e.who.slice(0, 1)}</span>
              <div className="oracle-feed-body">
                <p>
                  <strong>{e.who}</strong>{" "}
                  {e.kind === "open" ? (
                    <>
                      <span className={`oracle-dir is-${e.side}`}>{e.side === "long" ? "longed" : "shorted"}</span>{" "}
                      <strong className="tabular-nums">{usd0(e.stake)}</strong>
                    </>
                  ) : (
                    <>
                      closed <span className={`oracle-dir is-${e.side}`}>{e.side}</span>{" "}
                      <strong className={`tabular-nums ${(e.pnl ?? 0) >= 0 ? "is-gain" : "is-loss"}`}>{signedUsd(e.pnl ?? 0)}</strong>
                    </>
                  )}{" "}
                  <span className="oracle-feed-coin">
                    <span className={`market-symbol ${meta.symbolClass}`} aria-hidden="true">{meta.symbol}</span>
                    {meta.ticker}
                  </span>
                </p>
                <span className="oracle-feed-meta tabular-nums">
                  @ {formatPrice(e.price)} · {e.leverage}× · {ago(e.t, now)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
