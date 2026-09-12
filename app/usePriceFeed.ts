"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_MS, WINDOW_MS } from "./feedConfig";

export type PricePoint = { t: number; p: number };
export type FeedStatus = "connecting" | "live" | "reconnecting";

const FEED_URL = "wss://ws-feed.exchange.coinbase.com";
const FRESH_MS = 5000; // a tick older than this is not trusted for settlement
const CLOCK_MS = 100; // ~3px of chart travel per tick at the tightest zoom

// One sample of slack past the window so the chart can interpolate the point
// where the line crosses its left edge instead of starting in mid-air.
const trim = (points: PricePoint[]) => {
  const cutoff = Date.now() - WINDOW_MS - SAMPLE_MS;
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
 */
export function usePriceFeed(product: string = "BTC-USD") {
  const [samples, setSamples] = useState<PricePoint[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  // The chart draws a window ending *now*, so it needs a clock of its own:
  // a silent socket should scroll the axis past the last point, not freeze it.
  const [now, setNow] = useState(() => Date.now());

  const priceRef = useRef<number | null>(null);
  const tickAtRef = useRef(0);
  const lastSampleAtRef = useRef(0);

  // Latest tick, but only if it is recent enough to settle a round on.
  const getLivePrice = useCallback(() => {
    if (priceRef.current === null) return null;
    if (Date.now() - tickAtRef.current > FRESH_MS) return null;
    return priceRef.current;
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Switching product invalidates whatever was seeded/ticking for the old one.
    setSamples([]);
    setPrice(null);
    priceRef.current = null;
    tickAtRef.current = 0;
    lastSampleAtRef.current = 0;
    setStatus("connecting");

    fetch(`/api/history?symbol=${encodeURIComponent(product)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then(({ points: seed }: { points: PricePoint[] }) => {
        if (cancelled || seed.length === 0) return;
        setSamples((prev) => trim([...seed, ...prev].sort((a, b) => a.t - b.t)));
        setPrice((prev) => prev ?? seed[seed.length - 1].p);
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

    const connect = () => {
      let retried = false; // error and close both fire; reconnect once
      socket = new WebSocket(FEED_URL);

      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [product],
            channels: ["ticker"],
          }),
        );
      };

      socket.onmessage = (event) => {
        let message: { type?: string; price?: string };
        try {
          message = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (message.type !== "ticker" || message.price === undefined) return;

        const next = Number(message.price);
        if (!Number.isFinite(next) || next <= 0) return;

        const now = Date.now();
        priceRef.current = next;
        tickAtRef.current = now;
        setPrice(next);

        if (now - lastSampleAtRef.current >= SAMPLE_MS) {
          lastSampleAtRef.current = now;
          setSamples((prev) => trim([...prev, { t: now, p: next }]));
        }
      };

      const retry = () => {
        if (disposed || retried) return;
        retried = true;
        setStatus("reconnecting");
        const delay = Math.min(15000, 500 * 2 ** attempt++);
        reconnect = setTimeout(connect, delay);
      };

      socket.onerror = retry;
      socket.onclose = retry;
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnect);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [product]);

  // Committed samples plus a one-second live edge, so the leading point moves
  // at the same cadence as the rest of the line while the headline stays live.
  const points = useMemo<PricePoint[]>(() => {
    if (price === null) return samples;
    const edge = { t: tickAtRef.current || Date.now(), p: price };
    const last = samples[samples.length - 1];
    if (!last) return [edge];
    if (edge.t - last.t < SAMPLE_MS) return samples;
    return [...samples, edge];
  }, [samples, price]);

  return { price, points, status, now, getLivePrice };
}
