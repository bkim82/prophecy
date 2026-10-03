"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_MS, WINDOW_MS } from "./feedConfig";

export type PricePoint = { t: number; p: number };
export type FeedStatus = "connecting" | "live" | "reconnecting";
/** Rolling 24h figures straight off Coinbase's ticker message. */
export type DayStats = { open: number; high: number; low: number };

const FEED_URL = "wss://ws-feed.exchange.coinbase.com";
// Coinbase's ticker only fires on a trade: ETH can go 15s+ without one, DOGE
// 40s+. Liveness comes from the heartbeat channel (1/s regardless of trading),
// and the series is sampled on a clock, carrying the last price forward — a
// quiet tape is a flat line, not a stalled or vanished one.
const FRESH_MS = 5000; // no message (ticker or heartbeat) for this long → price not trusted
const STALL_MS = 8000; // no message for this long → socket is dead, reconnect
const CLOCK_MS = 100; // ~3px of chart travel per tick at the tightest zoom
// Socket silent this long → poll /api/ticker instead, so a blocked or dropped
// websocket still leaves the chart moving.
const POLL_AFTER_MS = 2500;
const POLL_MS = 2000;

// One sample of slack past the window so the chart can interpolate the point
// where the line crosses its left edge instead of starting in mid-air.
// Cut relative to the newest point, not the wall clock: a dead feed keeps its
// last window to show (frozen) rather than emptying the chart.
const trim = (points: PricePoint[]) => {
  const newest = points[points.length - 1]?.t ?? Date.now();
  const cutoff = Math.min(Date.now(), newest) - WINDOW_MS - SAMPLE_MS;
  const first = points.findIndex((point) => point.t >= cutoff);
  if (first === -1) return [];
  return first <= 0 ? points : points.slice(first);
};

/**
 * Live price from Coinbase's public ticker socket (no key, no auth), for a
 * given product (e.g. "BTC-USD", "ETH-USD").
 *
 * Every trade updates the headline price, but the plotted series commits one
 * point per SAMPLE_MS — dense tick noise draws as a flat band, while a point
 * every few seconds draws the actual peaks and dips.
 *
 * The series plots the bid/ask midpoint, not the last trade: trades alternate
 * between bid and ask, so on a quiet tape the trade price zigzags by a tick
 * with nothing actually moving. `price`/getLivePrice stay on the last trade.
 */
// Per-product series survive a market switch, so switching back is instant
// instead of starting from an empty chart.
const seriesCache = new Map<string, PricePoint[]>();

// Seed points that fall outside the live series — before it starts or after it
// ends. Inside, the live midpoints win; mixing in the seed's trade means there
// would zigzag between two sources.
const mergeSeed = (seed: PricePoint[], live: PricePoint[]) => {
  if (live.length === 0) return seed;
  const first = live[0].t;
  const last = live[live.length - 1].t;
  return [...seed.filter((point) => point.t < first), ...live, ...seed.filter((point) => point.t > last)];
};

export function usePriceFeed(product: string = "BTC-USD") {
  // Tagged with its product so a render between a switch and the reset effect
  // never shows (or caches) one market's line under another's name.
  const [series, setSeries] = useState<{ product: string; points: PricePoint[] }>(() => ({
    product,
    points: trim(seriesCache.get(product) ?? []),
  }));
  const samples = useMemo(
    () => (series.product === product ? series.points : trim(seriesCache.get(product) ?? [])),
    [series, product],
  );
  const [price, setPrice] = useState<number | null>(null);
  const [day, setDay] = useState<DayStats | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  // The chart draws a window ending *now*, so it needs a clock of its own:
  // a silent socket should scroll the axis past the last point, not freeze it.
  const [now, setNow] = useState(() => Date.now());

  const priceRef = useRef<number | null>(null);
  const midRef = useRef<number | null>(null);
  // Last message of any kind. A heartbeat with no trade means "price unchanged",
  // so freshness is about the connection, not the last trade.
  const heardAtRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const productRef = useRef(product);
  productRef.current = product;

  useEffect(() => {
    seriesCache.set(series.product, series.points);
  }, [series]);

  // Latest trade price, but only while the socket is provably alive.
  const getLivePrice = useCallback(() => {
    if (priceRef.current === null) return null;
    if (Date.now() - heardAtRef.current > FRESH_MS) return null;
    return priceRef.current;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      // Clock-driven sampling: one point per SAMPLE_MS while the feed is alive,
      // trade or no trade.
      const p = midRef.current;
      if (p === null || t - heardAtRef.current > FRESH_MS) return;
      if (t - lastSampleAtRef.current < SAMPLE_MS) return;
      lastSampleAtRef.current = t;
      setSeries((prev) =>
        prev.product === productRef.current ? { ...prev, points: trim([...prev.points, { t, p }]) } : prev,
      );
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Switching product invalidates whatever was ticking for the old one; start
    // from this product's cached series while the seed loads.
    const cached = trim(seriesCache.get(product) ?? []);
    setSeries({ product, points: cached });
    setPrice(null);
    setDay(null);
    priceRef.current = null;
    midRef.current = null;
    heardAtRef.current = 0;
    lastSampleAtRef.current = cached.at(-1)?.t ?? 0;
    setStatus("connecting");

    fetch(`/api/history?symbol=${encodeURIComponent(product)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then(({ points: seed }: { points: PricePoint[] }) => {
        if (cancelled || seed.length === 0) return;
        setSeries((prev) =>
          prev.product === product ? { product, points: trim(mergeSeed(seed, prev.points)) } : prev,
        );
        setPrice((prev) => prev ?? seed[seed.length - 1].p);
        // Seed only — the socket's first message is what makes it "alive".
        midRef.current ??= seed[seed.length - 1].p;
        // Continue the seed's cadence instead of committing a point immediately.
        lastSampleAtRef.current = Math.max(
          lastSampleAtRef.current,
          seed[seed.length - 1].t,
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [product]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;
    // A socket can die without closing (sleep, network swap). No message for
    // STALL_MS → force-close it and let the normal retry path reconnect.
    const watchdog = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN && Date.now() - heardAtRef.current > STALL_MS) {
        socket.close();
      }
    }, 1000);

    // REST fallback: while the socket is silent (connecting, backing off, or
    // blocked outright), poll the same Coinbase ticker over HTTP.
    let polling = false;
    const poller = setInterval(() => {
      if (polling || document.visibilityState !== "visible") return;
      if (Date.now() - heardAtRef.current < POLL_AFTER_MS) return;
      polling = true;
      fetch(`/api/ticker?symbol=${encodeURIComponent(product)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
        .then(({ price: next, bid, ask }: { price: number; bid: number | null; ask: number | null }) => {
          if (disposed || !(next > 0)) return;
          // The socket may have come back while this was in flight; it wins.
          if (Date.now() - heardAtRef.current < POLL_AFTER_MS) return;
          heardAtRef.current = Date.now();
          priceRef.current = next;
          midRef.current = bid && ask && ask >= bid ? (bid + ask) / 2 : next;
          setPrice(next);
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, POLL_MS);

    const connect = () => {
      let retried = false; // error and close both fire; reconnect once
      socket = new WebSocket(FEED_URL);
      const current = socket;

      socket.onopen = () => {
        attempt = 0;
        // Start the stall clock at open, not at the last message of a dead socket.
        heardAtRef.current = Date.now();
        setStatus("live");
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [product],
            channels: ["ticker", "heartbeat"],
          }),
        );
      };

      socket.onmessage = (event) => {
        let message: {
          type?: string;
          price?: string;
          best_bid?: string;
          best_ask?: string;
          open_24h?: string;
          high_24h?: string;
          low_24h?: string;
        };
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.type === "heartbeat") {
          heardAtRef.current = Date.now();
          return;
        }
        if (message.type !== "ticker" || message.price === undefined) return;

        const next = Number(message.price);
        if (!Number.isFinite(next) || next <= 0) return;

        const bid = Number(message.best_bid);
        const ask = Number(message.best_ask);
        const plotted = bid > 0 && ask >= bid ? (bid + ask) / 2 : next;

        const open = Number(message.open_24h);
        const high = Number(message.high_24h);
        const low = Number(message.low_24h);
        if (open > 0 && high > 0 && low > 0) {
          setDay((prev) =>
            prev && prev.open === open && prev.high === high && prev.low === low ? prev : { open, high, low },
          );
        }

        heardAtRef.current = Date.now();
        priceRef.current = next;
        midRef.current = plotted;
        setPrice(next);
        setStatus("live");
      };

      const retry = () => {
        if (disposed || retried || socket !== current) return;
        retried = true;
        setStatus("reconnecting");
        const delay = Math.min(15000, 500 * 2 ** attempt++);
        reconnect = setTimeout(connect, delay);
      };

      socket.onerror = retry;
      socket.onclose = retry;
    };

    connect();

    // Background tabs throttle timers and can strand the socket; on return,
    // reconnect immediately instead of waiting out the backoff or the watchdog.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || disposed) return;
      if (socket?.readyState === WebSocket.OPEN && Date.now() - heardAtRef.current <= STALL_MS) return;
      clearTimeout(reconnect);
      attempt = 0;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      connect();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      clearInterval(poller);
      clearTimeout(reconnect);
      document.removeEventListener("visibilitychange", onVisible);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [product]);

  // Committed samples plus a live edge pinned at `now` while the feed is alive,
  // so the head rides the right edge instead of waiting for the next sample.
  // A dead feed gets no edge: the line stops where the data stops.
  const points = useMemo<PricePoint[]>(() => {
    const live = midRef.current;
    const last = samples[samples.length - 1];
    if (live === null || now - heardAtRef.current > FRESH_MS) return samples;
    if (!last) return [{ t: now, p: live }];
    if (now <= last.t) return samples;
    return [...samples, { t: now, p: live }];
    // price is a dep so a trade between clock ticks still redraws the head.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, now, price]);

  // "live" means data is arriving, whichever path brings it: the REST fallback
  // keeps prices fresh while the socket is down, and the badge shouldn't say
  // "reconnecting" over a chart that is visibly updating.
  const feedStatus: FeedStatus = status !== "live" && now - heardAtRef.current <= FRESH_MS ? "live" : status;

  return { price, points, status: feedStatus, now, day, getLivePrice };
}
