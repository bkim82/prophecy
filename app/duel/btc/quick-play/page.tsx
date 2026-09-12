"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PriceChart, { type PredictionLine } from "../../../PriceChart";
import { usePriceFeed, type PricePoint } from "../../../usePriceFeed";

const ROUND_SECONDS = 60;

const P1_COLOR = "#8eafd0";
const P2_COLOR = "#9caaba";

type Phase = "predict" | "countdown" | "settling" | "result";

type Outcome = {
  finalPrice: number;
  p1: number;
  p2: number;
  diff1: number;
  diff2: number;
  winner: 1 | 2 | "tie";
};

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Page() {
  const { price, points, status, now, getLivePrice } = usePriceFeed();

  const [phase, setPhase] = useState<Phase>("predict");
  const [input1, setInput1] = useState("");
  const [input2, setInput2] = useState("");
  const [locked1, setLocked1] = useState<number | null>(null);
  const [locked2, setLocked2] = useState<number | null>(null);
  // When each player locked — the chart marks the moment, not just the price.
  const [lockedAt1, setLockedAt1] = useState<number | null>(null);
  const [lockedAt2, setLockedAt2] = useState<number | null>(null);

  // Seed each input from the live price once, so the number spinner's
  // arrows step from the current price instead of from 0.
  const seeded1 = useRef(false);
  const seeded2 = useRef(false);

  const [roundStart, setRoundStart] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settleError, setSettleError] = useState(false);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);

  // The chart needs the live series during play, but the settled series after.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const settle = useCallback(
    async (p1: number, p2: number) => {
      setPhase("settling");
      setSettleError(false);
      try {
        // The socket tick is the freshest number; REST covers a dropped feed.
        let finalPrice = getLivePrice();
        if (finalPrice === null) {
          const res = await fetch("/api/price", { cache: "no-store" });
          if (!res.ok) throw new Error("price unavailable");
          finalPrice = ((await res.json()) as { price: number }).price;
        }

        const diff1 = Math.abs(finalPrice - p1);
        const diff2 = Math.abs(finalPrice - p2);
        setFrozenPoints([
          ...pointsRef.current,
          { t: Date.now(), p: finalPrice },
        ]);
        setOutcome({
          finalPrice,
          p1,
          p2,
          diff1,
          diff2,
          winner: diff1 === diff2 ? "tie" : diff1 < diff2 ? 1 : 2,
        });
        setPhase("result");
      } catch {
        setSettleError(true);
      }
    },
    [getLivePrice],
  );

  useEffect(() => {
    if (price === null) return;
    if (!seeded1.current && input1 === "") setInput1(price.toFixed(2));
    seeded1.current = true;
  }, [price, input1]);

  useEffect(() => {
    if (price === null) return;
    if (!seeded2.current && input2 === "") setInput2(price.toFixed(2));
    seeded2.current = true;
  }, [price, input2]);

  // Run the countdown off a fixed deadline so it stays accurate.
  useEffect(() => {
    if (phase !== "countdown" || locked1 === null || locked2 === null) return;

    const deadline = Date.now() + ROUND_SECONDS * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        settle(locked1, locked2);
      }
    };

    const id = setInterval(tick, 200);
    tick();
    return () => clearInterval(id);
  }, [phase, locked1, locked2, settle]);

  const lock = (player: 1 | 2) => {
    if (phase !== "predict") return;

    const raw = player === 1 ? input1 : input2;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;

    const at = Date.now();
    const next1 = player === 1 ? value : locked1;
    const next2 = player === 2 ? value : locked2;
    if (player === 1) {
      setLocked1(value);
      setLockedAt1(at);
    } else {
      setLocked2(value);
      setLockedAt2(at);
    }

    if (next1 !== null && next2 !== null) {
      setRoundStart(at);
      setPhase("countdown");
    }
  };

  const playAgain = () => {
    setPhase("predict");
    setInput1("");
    setInput2("");
    setLocked1(null);
    setLocked2(null);
    setLockedAt1(null);
    setLockedAt2(null);
    setRoundStart(null);
    setSecondsLeft(ROUND_SECONDS);
    setOutcome(null);
    setSettleError(false);
    setFrozenPoints(null);
    seeded1.current = false;
    seeded2.current = false;
  };

  const nudge = (player: 1 | 2, pct: number) => {
    if (price === null || (player === 1 ? locked1 : locked2) !== null) return;
    const setInput = player === 1 ? setInput1 : setInput2;
    const current = Number(player === 1 ? input1 : input2);
    const base = Number.isFinite(current) && current > 0 ? current : price;
    setInput((base * (1 + pct)).toFixed(2));
  };

  const headlinePrice = outcome ? outcome.finalPrice : price;

  const predictionLines: PredictionLine[] = [
    ...(locked1 !== null
      ? [{ label: "P1", value: locked1, color: P1_COLOR, at: lockedAt1 }]
      : []),
    ...(locked2 !== null
      ? [{ label: "P2", value: locked2, color: P2_COLOR, at: lockedAt2 }]
      : []),
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/"
        className="text-xs uppercase tracking-wider text-[#718195] transition hover:text-[#b7c8d9]"
      >
        ← Menu
      </Link>

      <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[#8291a2]">
        BTC Duel · Quick Play
      </h1>

      {/* BTC price + countdown, centered */}
      <section className="mt-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs uppercase tracking-wider text-[#8291a2]">
            {outcome ? "Final BTC / USD" : "BTC / USD"}
          </p>
          {!outcome && (
            <span className="flex items-center gap-1.5 text-xs text-[#8291a2]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "live"
                    ? "animate-pulse bg-[#8ba9c7]"
                    : "bg-[#8794a3]"
                }`}
              />
              {status === "live" ? "live" : status}
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-semibold tabular-nums text-[#e7edf4]">
          {headlinePrice === null ? "Loading…" : usd(headlinePrice)}
        </p>

        <div className="mt-4 flex min-h-16 flex-col items-center justify-center">
          {phase === "predict" && (
            <p className="text-sm text-[#8291a2]">
              Both players lock a prediction to start the 60-second round.
            </p>
          )}
          {phase === "countdown" && (
            <>
              <p className="text-xs uppercase tracking-wider text-[#8291a2]">
                Time left
              </p>
              <p className="text-4xl font-semibold tabular-nums">
                {secondsLeft}s
              </p>
            </>
          )}
          {phase === "settling" && (
            <p className="text-sm text-[#8291a2]">
              {settleError
                ? "Could not fetch the final price."
                : "Fetching final price…"}
            </p>
          )}
          {settleError && locked1 !== null && locked2 !== null && (
            <button
              onClick={() => settle(locked1, locked2)}
              className="mt-2 rounded-md border border-[#3b4c5f] bg-[#152231] px-3 py-1.5 text-sm text-[#c3d0dc] transition hover:border-[#6e89a4] hover:bg-[#1a2b3d]"
            >
              Retry
            </button>
          )}
        </div>
      </section>

      <section className="mt-2">
        <PriceChart
          points={frozenPoints ?? points}
          predictions={predictionLines}
          roundStart={roundStart}
          frozen={frozenPoints !== null}
          now={now}
        />
      </section>

      {/* Player 1 left, Player 2 right */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        {([1, 2] as const).map((player) => {
          const locked = player === 1 ? locked1 : locked2;
          const input = player === 1 ? input1 : input2;
          const setInput = player === 1 ? setInput1 : setInput2;
          const color = player === 1 ? P1_COLOR : P2_COLOR;
          const isWinner = outcome !== null && outcome.winner === player;

          return (
            <div
              key={player}
              className={`rounded-xl border bg-[#131e2a] p-5 ${
                isWinner
                  ? "border-[#8eafd0] ring-1 ring-[#8eafd0]"
                  : "border-[#2b3b4d]"
              }`}
            >
              <h2 className="flex items-center gap-2 font-medium text-[#d7e1eb]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                Player {player}
              </h2>

              <label className="mt-4 block text-xs uppercase tracking-wider text-[#8291a2]">
                Prediction after 60s (USD)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={locked !== null ? String(locked) : input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") lock(player);
                }}
                disabled={locked !== null}
                placeholder={price !== null ? price.toFixed(2) : "0.00"}
                className="mt-1 w-full rounded-md border border-[#3a4b5e] bg-[#0d1722] px-3 py-2 text-lg text-[#e7edf4] tabular-nums outline-none transition placeholder:text-[#536375] focus:border-[#86a5c4] disabled:bg-[#1a2735] disabled:text-[#718195]"
              />

              {locked === null && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => nudge(player, -0.001)}
                    disabled={price === null}
                    className="rounded-md border border-[#3a4b5e] py-1 text-xs font-medium text-[#9cabb9] transition hover:border-[#6e89a4] hover:bg-[#1a2b3d] disabled:opacity-50"
                  >
                    -0.1%
                  </button>
                  <button
                    type="button"
                    onClick={() => nudge(player, 0.001)}
                    disabled={price === null}
                    className="rounded-md border border-[#3a4b5e] py-1 text-xs font-medium text-[#9cabb9] transition hover:border-[#6e89a4] hover:bg-[#1a2b3d] disabled:opacity-50"
                  >
                    +0.1%
                  </button>
                </div>
              )}

              {locked === null ? (
                <button
                  onClick={() => lock(player)}
                  disabled={!(Number(input) > 0)}
                  className="mt-3 w-full rounded-md bg-[#334c65] px-3 py-2 text-sm font-medium text-[#edf4fa] transition hover:bg-[#405f7c] disabled:bg-[#293746] disabled:text-[#657486]"
                >
                  Lock Prediction
                </button>
              ) : (
                <p className="mt-3 py-2 text-center text-sm font-medium text-[#a9c4dd]">
                  Locked at {usd(locked)}
                </p>
              )}

              {outcome !== null && (
                <dl className="mt-4 space-y-1 border-t border-[#2b3b4d] pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[#8291a2]">Prediction</dt>
                    <dd className="tabular-nums">
                      {usd(player === 1 ? outcome.p1 : outcome.p2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#8291a2]">Off by</dt>
                    <dd className="tabular-nums">
                      {usd(player === 1 ? outcome.diff1 : outcome.diff2)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          );
        })}
      </section>

      {/* Result */}
      {outcome !== null && (
        <section className="mt-6 rounded-xl border border-[#2b3b4d] bg-[#131e2a] p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-[#8291a2]">
            Winner
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {outcome.winner === "tie"
              ? "Tie — identical predictions"
              : `Player ${outcome.winner}`}
          </p>
          <p className="mt-2 text-sm text-[#8291a2]">
            Final price {usd(outcome.finalPrice)} · P1 off by{" "}
            {usd(outcome.diff1)} · P2 off by {usd(outcome.diff2)}
          </p>
          <button
            onClick={playAgain}
            className="mt-5 rounded-md bg-[#334c65] px-5 py-2 text-sm font-medium text-[#edf4fa] transition hover:bg-[#405f7c]"
          >
            Play Again
          </button>
        </section>
      )}
    </main>
  );
}
