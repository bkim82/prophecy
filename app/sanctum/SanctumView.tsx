"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type TradeMarker } from "@/app/PriceChart";
import { usePriceFeed } from "@/app/usePriceFeed";
import { getWalletProvider, shortenAddress } from "@/app/lib/wallet";
import {
  ROOM,
  ROOM_COINS,
  ROOM_MEMBERS,
  chatLineFor,
  coinMeta,
  pick,
  seedChat,
  type RoomChatMessage,
  type RoomCoin,
  type RoomSide,
} from "@/app/lib/roomsMocks";
import { RoomChat } from "@/app/sanctum/RoomChat";
import { RoomFeed, formatPrice, type RoomEvent } from "@/app/sanctum/RoomFeed";

// No USD rail yet: without a wallet the room trades against preview funds so
// the loop is visible. Nothing here settles. See docs/rooms.md.
const PREVIEW_BALANCE = 1000;
const STAKE_OPTIONS = [25, 100, 300, 500];
const LEVERAGE_OPTIONS = [100, 1000, 10000];
const MAX_EVENTS = 80;
const SIM_TICK_MS = 1700;
// Rough share of room activity per coin — majors dominate, the daily coin
// still shows up.
const COIN_WEIGHTS: [RoomCoin, number][] = [["btc", 0.45], ["eth", 0.35], ["daily", 0.2]];

type Position = { coin: RoomCoin; side: RoomSide; stake: number; leverage: number; entryPrice: number; openedAt: number };

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--positive)" : "var(--negative)");
const sideColor = (side: RoomSide) => (side === "long" ? "var(--chart-up)" : "var(--chart-down)");

// Same directional model as solo Pulse, but a position can't lose more than
// its stake — this is meant to be real money.
const positionPnl = (p: Pick<Position, "side" | "stake" | "leverage" | "entryPrice">, price: number) => {
  const move = p.side === "long" ? price - p.entryPrice : p.entryPrice - price;
  return Math.max(-p.stake, p.stake * (move / p.entryPrice) * p.leverage);
};

const weightedCoin = (): RoomCoin => {
  let r = Math.random();
  for (const [coin, w] of COIN_WEIGHTS) {
    if ((r -= w) <= 0) return coin;
  }
  return "btc";
};

let eventSeq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${eventSeq++}`;

function OracleSigil() {
  return (
    <svg className="oracle-sigil" viewBox="0 0 64 64" aria-hidden="true">
      <g className="oracle-sigil-ring">
        <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 5" />
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M32 1.5 L33.6 6 L32 5 L30.4 6 Z" fill="currentColor" transform={`rotate(${i * 45} 32 32)`} />
        ))}
      </g>
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      <path d="M12 32s8.5-11 20-11 20 11 20 11-8.5 11-20 11-20-11-20-11Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="32" cy="32" r="6.5" className="oracle-sigil-iris" />
      <circle cx="32" cy="32" r="2.4" fill="var(--bg)" />
    </svg>
  );
}

function useWalletAddress() {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    // eth_accounts never prompts — it only reports an already-granted connection.
    const refresh = () => provider.request({ method: "eth_accounts" }).then(
      (accounts) => setAddress((accounts as string[])[0] ?? null),
      () => {},
    );
    void refresh();
    const onAccounts = (...args: unknown[]) => setAddress(((args[0] as string[]) ?? [])[0] ?? null);
    provider.on?.("accountsChanged", onAccounts);
    // Coinbase Wallet SDK's disconnect() only emits "disconnect", not "accountsChanged" —
    // the Wallet tab's Disconnect button dispatches this app-level event instead so every
    // wallet-aware component (here, BalancePill) stays in sync.
    window.addEventListener("wallet-updated", refresh);
    return () => { provider.removeListener?.("accountsChanged", onAccounts); window.removeEventListener("wallet-updated", refresh); };
  }, []);
  return address;
}

export function SanctumView() {
  const feeds = {
    btc: usePriceFeed(coinMeta("btc").product),
    eth: usePriceFeed(coinMeta("eth").product),
    daily: usePriceFeed(coinMeta("daily").product),
  };
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;

  const wallet = useWalletAddress();
  const [coin, setCoin] = useState<RoomCoin>("btc");
  const [balance, setBalance] = useState(PREVIEW_BALANCE);
  const [positions, setPositions] = useState<Partial<Record<RoomCoin, Position>>>({});
  const [stake, setStake] = useState(100);
  const [leverage, setLeverage] = useState(1000);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [chat, setChat] = useState<RoomChatMessage[]>(seedChat);
  const coinRef = useRef<HTMLDetailsElement>(null);
  const stakeRef = useRef<HTMLDetailsElement>(null);
  const leverageRef = useRef<HTMLDetailsElement>(null);

  const meta = coinMeta(coin);
  const feed = feeds[coin];
  const now = feed.now;
  const position = positions[coin];
  const openStakes = Object.values(positions).reduce((sum, p) => sum + (p?.stake ?? 0), 0);
  const available = Math.max(0, balance - openStakes);
  const livePnl = position && feed.price !== null ? positionPnl(position, feed.price) : 0;

  const pushEvent = useCallback((event: RoomEvent) => {
    setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
  }, []);

  // --- The rest of the room: simulated Oracles trading the same live prices. ---
  const memberPositions = useRef(new Map<string, Position>());
  useEffect(() => {
    const priceOf = (c: RoomCoin) => feedsRef.current[c].getLivePrice();
    let seeded = false;

    const openFor = (name: string, at: number): RoomEvent | null => {
      const member = ROOM_MEMBERS.find((m) => m.name === name)!;
      const c = weightedCoin();
      const price = priceOf(c);
      if (price === null) return null;
      const side: RoomSide = Math.random() < member.bias ? "long" : "short";
      const [lo, hi] = member.size;
      const amount = Math.round((lo + Math.random() * (hi - lo)) / 10) * 10;
      const lev = pick(member.leverage);
      memberPositions.current.set(name, { coin: c, side, stake: amount, leverage: lev, entryPrice: price, openedAt: at });
      return { id: nextId("m"), t: at, who: name, coin: c, kind: "open", side, stake: amount, leverage: lev, price };
    };

    const tick = () => {
      if (!seeded) {
        if (ROOM_COINS.some((c) => priceOf(c.id) === null)) return;
        seeded = true;
        // A room you walk into is already mid-conversation.
        const seed = ROOM_MEMBERS.slice(0, 5)
          .map((m, i) => openFor(m.name, Date.now() - (45 - i * 8) * 1000))
          .filter((e): e is RoomEvent => e !== null)
          .reverse();
        setEvents((current) => [...current, ...seed].slice(0, MAX_EVENTS));
        return;
      }
      if (Math.random() < 0.35) return;

      const member = pick(ROOM_MEMBERS);
      const open = memberPositions.current.get(member.name);
      let event: RoomEvent | null = null;
      if (open) {
        const price = priceOf(open.coin);
        if (price === null || Date.now() - open.openedAt < 8000 || Math.random() < 0.4) return;
        memberPositions.current.delete(member.name);
        event = { id: nextId("m"), t: Date.now(), who: member.name, coin: open.coin, kind: "close", side: open.side, stake: open.stake, leverage: open.leverage, price, pnl: positionPnl(open, price) };
      } else {
        event = openFor(member.name, Date.now());
      }
      if (!event) return;
      pushEvent(event);

      if (Math.random() < 0.22) {
        const line = pick(chatLineFor(event.side, coinMeta(event.coin).ticker, event.pnl));
        setChat((current) => [...current, { id: nextId("c"), author: event.who, text: line, time: Date.now() }].slice(-40));
      }
    };

    const id = window.setInterval(tick, SIM_TICK_MS);
    return () => window.clearInterval(id);
  }, [pushEvent]);

  // --- Your trades ---
  const enter = (side: RoomSide) => {
    const price = feed.getLivePrice();
    const amount = Math.min(stake, available);
    if (price === null || position || amount <= 0) return;
    const at = Date.now();
    setPositions((current) => ({ ...current, [coin]: { coin, side, stake: amount, leverage, entryPrice: price, openedAt: at } }));
    pushEvent({ id: nextId("y"), t: at, who: "You", coin, kind: "open", side, stake: amount, leverage, price });
  };

  const close = useCallback(
    (target: RoomCoin, reverse = false) => {
      const open = positions[target];
      const price = feedsRef.current[target].getLivePrice();
      if (!open || price === null) return;
      const pnl = positionPnl(open, price);
      const at = Date.now();
      setBalance((b) => Math.max(0, b + pnl));
      pushEvent({ id: nextId("y"), t: at, who: "You", coin: target, kind: "close", side: open.side, stake: open.stake, leverage: open.leverage, price, pnl });
      if (reverse && pnl > -open.stake) {
        const side: RoomSide = open.side === "long" ? "short" : "long";
        const amount = Math.min(open.stake, open.stake + pnl);
        setPositions((current) => ({ ...current, [target]: { ...open, side, stake: amount, entryPrice: price, openedAt: at } }));
        pushEvent({ id: nextId("y"), t: at + 1, who: "You", coin: target, kind: "open", side, stake: amount, leverage: open.leverage, price });
      } else {
        setPositions((current) => {
          const next = { ...current };
          delete next[target];
          return next;
        });
      }
    },
    [positions, pushEvent],
  );

  // A position that has lost its whole stake is closed for you.
  useEffect(() => {
    for (const c of ROOM_COINS) {
      const open = positions[c.id];
      const price = feeds[c.id].price;
      if (open && price !== null && positionPnl(open, price) <= -open.stake) close(c.id);
    }
  });

  const sendChat = (text: string) =>
    setChat((current) => [...current, { id: nextId("c"), author: "You", text, time: Date.now() }].slice(-40));

  const markers: TradeMarker[] = events
    .filter((e) => e.coin === coin)
    .map((e) => ({
      t: e.t,
      p: e.price,
      side: e.side,
      action: e.kind === "open" ? "entry" : "exit",
      owner: e.who === "You" ? "you" : "room",
      pnl: e.who === "You" ? e.pnl : undefined,
    }));
  const otherPositions = ROOM_COINS.filter((c) => c.id !== coin && positions[c.id]);
  const dayChange = feed.day && feed.price !== null ? ((feed.price - feed.day.open) / feed.day.open) * 100 : null;
  const closeDetails = (ref: React.RefObject<HTMLDetailsElement | null>) => {
    if (ref.current) ref.current.open = false;
  };

  return (
    <main className="oracle-shell" data-room="oracle">
      <header className="oracle-hero">
        <OracleSigil />
        <div className="oracle-hero-copy">
          <span className="eyebrow">{ROOM.eyebrow} · {ROOM.subrank}</span>
          <h1 className="display-font">{ROOM.label}</h1>
          <span className="oracle-tagline">{ROOM.tagline}</span>
        </div>
        <div className="oracle-hero-chips">
          <span className="oracle-chip">
            <span className="oracle-chip-dot" aria-hidden="true" />
            {ROOM.online} online
          </span>
          {wallet ? (
            <span className="oracle-chip is-wallet">USD · {shortenAddress(wallet)}</span>
          ) : (
            <Link href="/wallet" className="oracle-chip is-wallet is-disconnected">
              Wallet not connected · Connect →
            </Link>
          )}
        </div>
      </header>

      <div className="oracle-grid">
        <aside className="oracle-chat-col">
          <RoomChat messages={chat} now={now} online={ROOM.online} onSend={sendChat} />
        </aside>

        <section className="oracle-stage arena-shell" data-market={meta.market}>
          <div className="oracle-quote">
            <div>
              <p className="oracle-quote-label">
                {meta.ticker} / USD
                <span className={`oracle-feed-status${feed.status === "live" ? " is-live" : ""}`}>{feed.status}</span>
              </p>
              <p className="oracle-quote-price tabular-nums">
                {feed.price === null ? "Loading…" : formatPrice(feed.price)}
                {dayChange !== null && (
                  <span className="oracle-quote-change" style={{ color: pnlColor(dayChange) }}>
                    {dayChange >= 0 ? "+" : ""}
                    {dayChange.toFixed(2)}% · 24h
                  </span>
                )}
              </p>
            </div>

            <details className="oracle-coin-select" ref={coinRef}>
              <summary aria-label={`Market: ${meta.ticker}`}>
                <span className={`market-symbol ${meta.symbolClass}`} aria-hidden="true">{meta.symbol}</span>
                <span className="oracle-coin-name">
                  {coin === "daily" && <small>Daily</small>}
                  {meta.ticker}
                </span>
                <span className="dock-select-chevron">▾</span>
              </summary>
              <div className="oracle-coin-menu" role="listbox" aria-label="Market">
                {ROOM_COINS.map((c) => {
                  const price = feeds[c.id].price;
                  const mine = positions[c.id];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      data-market={c.market}
                      aria-selected={c.id === coin}
                      className={c.id === coin ? "active" : ""}
                      onClick={() => {
                        setCoin(c.id);
                        closeDetails(coinRef);
                      }}
                    >
                      <span className={`market-symbol ${c.symbolClass}`} aria-hidden="true">{c.symbol}</span>
                      <span className="oracle-coin-name">
                        {c.id === "daily" && <small>Daily</small>}
                        {c.ticker}
                      </span>
                      <span className="oracle-coin-price tabular-nums">{price === null ? "—" : formatPrice(price)}</span>
                      {mine && <span className={`oracle-coin-pos is-${mine.side}`} title={`Your ${mine.side} is open`} />}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>

          <PriceChart
            points={feed.points}
            trades={markers}
            openEntry={position ? { t: position.openedAt, p: position.entryPrice, side: position.side } : null}
            now={now}
          />
          <p className="oracle-chart-key">Your trades solid · the room&apos;s dashed · ○ entries □ exits</p>

          <section className="arena-dock dock-bar oracle-dock">
            <div className="oracle-dock-balance">
              <span>
                Balance <strong className="tabular-nums">{usd(balance)}</strong>
              </span>
              <span>
                Available <strong className="tabular-nums">{usd(available)}</strong>
              </span>
              {!wallet && <span className="oracle-preview-tag" title="Connect a wallet to trade real USD">Preview funds</span>}
            </div>

            {position ? (
              <>
                <div className="dock-row">
                  <span className="dock-chip" style={{ borderColor: sideColor(position.side), color: sideColor(position.side) }}>
                    {position.side.toUpperCase()}
                  </span>
                  <span className="dock-live-pnl dock-pnl-hero" style={{ color: pnlColor(livePnl) }}>
                    {signedUsd(livePnl)}
                  </span>
                  <span className="dock-meta">
                    <span>{formatPrice(position.entryPrice)} → {feed.price !== null ? formatPrice(feed.price) : "—"}</span>
                    <span>{usd(position.stake)} · {position.leverage}×</span>
                  </span>
                </div>
                <div className="dock-row">
                  <button type="button" className={`dock-action is-${position.side}`} onClick={() => close(coin)}>
                    Close {signedUsd(livePnl)}
                  </button>
                  <button type="button" className="dock-action-secondary" onClick={() => close(coin, true)}>
                    Reverse
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="dock-row">
                  <details className="dock-select" ref={stakeRef}>
                    <summary>
                      <span className="dock-select-label">Amount</span>
                      <span className="dock-select-value">{usd(Math.min(stake, available))}</span>
                      <span className="dock-select-chevron">▾</span>
                    </summary>
                    <div className="dock-select-menu">
                      {STAKE_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={option > available}
                          className={stake === option ? "is-selected" : ""}
                          onClick={() => {
                            setStake(option);
                            closeDetails(stakeRef);
                          }}
                        >
                          {usd(option)}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={available <= 0}
                        className={stake === available ? "is-selected" : ""}
                        onClick={() => {
                          setStake(available);
                          closeDetails(stakeRef);
                        }}
                      >
                        Max
                      </button>
                    </div>
                  </details>
                  <details className="dock-select" ref={leverageRef}>
                    <summary>
                      <span className="dock-select-label">Leverage</span>
                      <span className="dock-select-value">{leverage}×</span>
                      <span className="dock-select-chevron">▾</span>
                    </summary>
                    <div className="dock-select-menu">
                      {LEVERAGE_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={leverage === option ? "is-selected" : ""}
                          onClick={() => {
                            setLeverage(option);
                            closeDetails(leverageRef);
                          }}
                        >
                          {option}×
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
                <div className="dock-row">
                  {(["long", "short"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      disabled={feed.price === null || available <= 0}
                      className={`dock-action is-${side}`}
                      onClick={() => enter(side)}
                    >
                      {side === "long" ? `↗ Long ${meta.ticker}` : `↘ Short ${meta.ticker}`}
                    </button>
                  ))}
                </div>
              </>
            )}

            {otherPositions.length > 0 && (
              <div className="oracle-dock-elsewhere">
                {otherPositions.map((c) => {
                  const open = positions[c.id]!;
                  const price = feeds[c.id].price;
                  const pnl = price === null ? 0 : positionPnl(open, price);
                  return (
                    <button key={c.id} type="button" onClick={() => setCoin(c.id)}>
                      {c.ticker} <span style={{ color: sideColor(open.side) }}>{open.side}</span>{" "}
                      <span className="tabular-nums" style={{ color: pnlColor(pnl) }}>{signedUsd(pnl)}</span> →
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <aside className="oracle-feed-col">
          <RoomFeed events={events} now={now} />
        </aside>
      </div>
    </main>
  );
}
