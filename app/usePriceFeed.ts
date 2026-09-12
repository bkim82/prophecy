"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_MS, WINDOW_MS } from "./feedConfig";

export type PricePoint = { t: number; p: number };
export type FeedStatus = "connecting" | "live" | "reconnecting";

const FEED_URL = "wss://ws-feed.exchange.coinbase.com";
const FRESH_MS = 5000; // a tick older than this is not trusted for settlement

const trim = (points: PricePoint[]) => {
  const cutoff = Date.now() - WINDOW_MS;
  const first = points.findIndex((point) => point.t >= cutoff);
  return first <= 0 ? points : points.slice(first);
};

/**
 * Live BTC/USD from Coinbase's public ticker socket (no key, no auth).
 *
 * Every trade updates the headline price, but the plotted series commits one
 * point per SAMPLE_MS — dense tick noise draws as a flat band, while a point
 * every few seconds draws the actual peaks and dips.
 */
export function usePriceFeed() {
  const [samples, setSamples] = useState<PricePoint[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");

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
    let cancelled = false;

    fetch("/api/history", { cache: "no-store" })
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
  }, []);

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
            product_ids: ["BTC-USD"],
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
  }, []);

  // Committed samples plus a live edge, so the leading point tracks each tick
  // while the rest of the line keeps its shape.
  const points = useMemo<PricePoint[]>(() => {
    if (price === null) return samples;
    const edge = { t: tickAtRef.current || Date.now(), p: price };
    const last = samples[samples.length - 1];
    if (!last) return [edge];
    if (edge.t - last.t < 500) return samples;
    return [...samples, edge];
  }, [samples, price]);

  return { price, points, status, getLivePrice };
}
