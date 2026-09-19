"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type PredictionLine } from "@/app/PriceChart";
import { usePriceFeed, type PricePoint } from "@/app/usePriceFeed";
import { productForMarket } from "@/lib/spotPrice";

const ROUND_SECONDS = 60;
const PRACTICE_COLOR = "var(--p1)";

type Phase = "setup" | "running" | "settling" | "result";

type Outcome = {
  finalPrice: number;
  prediction: number;
  offBy: number;
  errorPercent: number;
};

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatTime = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(
    Math.max(0, seconds) % 60,
  ).padStart(2, "0")}`;

export default function Page({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = use(params);
  const product = productForMarket(market) ?? "BTC-USD";
  const marketLabel = market.toUpperCase();
  const { price, points, status, now, getLivePrice } = usePriceFeed(product);
  const [phase, setPhase] = useState<Phase>("setup");
  const [input, setInput] = useState("");
  const [prediction, setPrediction] = useState<number | null>(null);
  const [roundStart, setRoundStart] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const priceRef = useRef(price);
  const pointsRef = useRef(points);
  const predictionRef = useRef<number | null>(null);

  priceRef.current = price;
  pointsRef.current = points;

  const currentPrice = price ?? priceRef.current;

  useEffect(() => {
    if (price !== null && input === "") setInput(price.toFixed(2));
  }, [price, input]);

  const settle = useCallback(async () => {
    setPhase("settling");
    setSettleError(false);
    try {
      let finalPrice = getLivePrice();
      if (finalPrice === null) {
        const response = await fetch(`/api/price?symbol=${encodeURIComponent(product)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("price unavailable");
        finalPrice = ((await response.json()) as { price: number }).price;
      }

      const lockedPrediction = predictionRef.current;
      if (lockedPrediction === null) throw new Error("prediction unavailable");
      const offBy = Math.abs(finalPrice - lockedPrediction);
      setOutcome({
        finalPrice,
        prediction: lockedPrediction,
        offBy,
        errorPercent: (offBy / finalPrice) * 100,
      });
      setFrozenPoints([...pointsRef.current, { t: Date.now(), p: finalPrice }]);
      setPhase("result");
    } catch {
      setSettleError(true);
      setPhase("settling");
    }
  }, [getLivePrice, product]);

  useEffect(() => {
    if (roundStart === null || phase !== "running") return;
    const deadline = roundStart + ROUND_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        void settle();
      }
    };
    const id = setInterval(tick, 200);
    tick();
    return () => clearInterval(id);
  }, [phase, roundStart, settle]);

  const lockPrediction = () => {
    const next = Number(input);
    if (phase !== "setup" || !Number.isFinite(next) || next <= 0 || currentPrice === null) return;
    predictionRef.current = next;
    setPrediction(next);
    setRoundStart(Date.now());
    setSecondsLeft(ROUND_SECONDS);
    setPhase("running");
  };

  const playAgain = () => {
    setPhase("setup");
    setPrediction(null);
    predictionRef.current = null;
    setRoundStart(null);
    setSecondsLeft(ROUND_SECONDS);
    setOutcome(null);
    setSettleError(false);
    setFrozenPoints(null);
    if (currentPrice !== null) setInput(currentPrice.toFixed(2));
  };

  const predictionLine: PredictionLine[] =
    prediction === null
      ? []
      : [{ label: "You", value: prediction, color: PRACTICE_COLOR, at: roundStart }];
  const headlinePrice = outcome?.finalPrice ?? currentPrice;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/duel"
        className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
      >
        ← Menu
      </Link>

      <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        {marketLabel} Practice · Cast
      </h1>

      <section className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            {outcome ? `Final ${marketLabel} / USD` : `${marketLabel} / USD`}
          </p>
          {!outcome && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "live" ? "animate-pulse bg-[var(--brand)]" : "bg-[var(--muted-dim)]"
                }`}
              />
              {status === "live" ? "live" : status}
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-semibold tabular-nums text-[var(--text)]">
          {headlinePrice === null ? "Loading…" : usd(headlinePrice)}
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {phase === "setup" && "Make a call. No wager, just practice."}
          {phase === "running" && `Round live · ${formatTime(secondsLeft)} left`}
          {phase === "settling" && (settleError ? "Could not fetch the final price." : "Checking your call…")}
          {phase === "result" && "Round complete · see how close you got."}
        </p>
      </section>

      <section className="mt-4">
        <PriceChart
          points={frozenPoints ?? points}
          predictions={predictionLine}
          roundStart={roundStart}
          frozen={frozenPoints !== null}
          now={now}
        />
      </section>

      <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        {phase === "setup" && (
          <div className="mx-auto max-w-md">
            <label className="text-xs uppercase tracking-wider text-[var(--muted)]" htmlFor="practice-prediction">
              Where will it land after {ROUND_SECONDS}s? (USD)
            </label>
            <input
              id="practice-prediction"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") lockPrediction();
              }}
              placeholder={currentPrice?.toFixed(2) ?? "0.00"}
              className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--field-bg)] px-3 py-3 text-lg text-[var(--text)] tabular-nums outline-none transition placeholder:text-[var(--muted-dim)] focus:border-[var(--brand)]"
            />
            <button
              type="button"
              onClick={lockPrediction}
              disabled={currentPrice === null || !(Number(input) > 0)}
              className="mt-3 w-full rounded-md bg-[var(--btn-bg)] px-3 py-3 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)] disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
            >
              Lock practice call
            </button>
          </div>
        )}

        {phase === "running" && prediction !== null && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Your call</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">{usd(prediction)}</p>
            </div>
            <span className="rounded-md border border-[var(--line)] px-3 py-2 text-xs uppercase tracking-wider text-[var(--muted)]">
              Watching the tape
            </span>
          </div>
        )}

        {phase === "settling" && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[var(--muted)]">
              {settleError ? "Could not fetch the final price." : "Fetching final price…"}
            </p>
            {settleError && (
              <button
                type="button"
                onClick={() => void settle()}
                className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--text)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {phase === "result" && outcome && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Final price {usd(outcome.finalPrice)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">
                Off by {usd(outcome.offBy)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Your {usd(outcome.prediction)} call was {outcome.errorPercent.toFixed(2)}% away.
              </p>
            </div>
            <button
              type="button"
              onClick={playAgain}
              className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
            >
              Practice again
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
