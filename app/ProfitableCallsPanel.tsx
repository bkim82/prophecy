"use client";

import { useState } from "react";
import type { Market } from "@/app/lib/mockPosts";
import { PROFITABLE_CALLS, type CallWindow, type ProfitableCall } from "@/app/lib/sidebarMocks";

const MARKET_META: Record<Market, { label: string; symbol: string; symbolClass: string }> = {
  btc: { label: "BTC", symbol: "₿", symbolClass: "btc-symbol" },
  eth: { label: "ETH", symbol: "Ξ", symbolClass: "eth-symbol" },
  doge: { label: "DOGE", symbol: "Ð", symbolClass: "doge-symbol" },
};

const WINDOWS: { id: CallWindow; label: string }[] = [
  { id: "1h", label: "1H" },
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
];

const TOP_CALLS = 3;

// Return on margin: the price move times leverage, flipped for shorts — so a
// 10x long on a +1.8% move is +18%, and that's what the panel ranks by.
function callRoi(call: ProfitableCall) {
  return call.changePct * call.leverage * (call.side === "SHORT" ? -1 : 1);
}

const formatRoi = (roi: number) => `${roi >= 0 ? "+" : "−"}${Math.abs(roi).toFixed(1)}%`;

export function ProfitableCallsPanel() {
  const [activeWindow, setActiveWindow] = useState<CallWindow>("24h");
  const ranked = PROFITABLE_CALLS[activeWindow]
    .map((call) => ({ call, roi: callRoi(call) }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, TOP_CALLS);

  return (
    <section className="panel sidebar-panel sidebar-panel--calls">
      <div className="sidebar-calls-head">
        <h3>Most Profitable Calls</h3>
        <div className="sidebar-window-tabs" role="tablist" aria-label="Time window">
          {WINDOWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeWindow === id}
              className={activeWindow === id ? "active" : undefined}
              onClick={() => setActiveWindow(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ol className="sidebar-calls-list">
        {ranked.map(({ call, roi }) => {
          const meta = MARKET_META[call.market];
          return (
            <li className="sidebar-row sidebar-row--call" key={call.id}>
              <div className="sidebar-row-main">
                <span className={`market-symbol ${meta.symbolClass}`}>{meta.symbol}</span>
                <div className="sidebar-call-text">
                  <strong>
                    {meta.label} {call.side === "LONG" ? "↑" : "↓"} {call.side}
                  </strong>
                  <span className="sidebar-call-detail">
                    {call.leverage}× · {call.handle}
                  </span>
                </div>
              </div>
              <span className={`sidebar-value sidebar-call-roi ${roi >= 0 ? "is-up" : "is-down"}`}>{formatRoi(roi)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
