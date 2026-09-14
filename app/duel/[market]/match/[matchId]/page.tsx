"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInButton, useUser } from "@clerk/nextjs";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PriceChart, { type PredictionLine } from "@/app/PriceChart";
import { usePriceFeed, type PricePoint } from "@/app/usePriceFeed";
import { getPlayerId } from "@/app/lib/playerId";
import { clearActiveMatch, setActiveMatch } from "@/app/lib/activeMatch";
import { productForMarket } from "@/lib/spotPrice";
import type { MatchView } from "@/lib/match";

// One poll drives everything: state, the presence heartbeat, and the lazy
// settlement the server runs when it notices the deadline has passed.
const POLL_MS = 1000;
const TICK_MS = 200;

const YOU_COLOR = "var(--p1)";
const OPP_COLOR = "var(--p2)";

type Gone = "ended" | "forbidden" | null;

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Page({
  params,
}: {
  params: Promise<{ market: string; matchId: string }>;
}) {
  const { market, matchId } = use(params);
  const router = useRouter();
  const { isSignedIn, isLoaded } = useUser();
  const product = productForMarket(market) ?? "BTC-USD";
  const { price, points, status, now } = usePriceFeed(product);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [gone, setGone] = useState<Gone>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [frozenPoints, setFrozenPoints] = useState<PricePoint[] | null>(null);
  const [inviteJoin, setInviteJoin] = useState(false);

  // Server timestamps arrive on the server's clock; everything the UI draws
  // (countdown deadline, chart markers) has to be on the browser's.
  const skewRef = useRef(0);
  const toLocal = useCallback(
    (serverMs: number | null) =>
      serverMs === null ? null : serverMs - skewRef.current,
    [],
  );

  // The chart needs the live series while playing and a snapshot after.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    setPlayerId(getPlayerId());
    setInviteJoin(new URLSearchParams(window.location.search).get("invite") === "1");
  }, []);

  const applyView = useCallback((next: MatchView) => {
    skewRef.current = next.serverNow - Date.now();
    setView(next);
  }, []);

  // Once the round is actually underway, remember it so a global bar can
  // offer a way back in from anywhere else in the app - leaving this page
  // does not call `leave`, so the match keeps running server-side either way.
  useEffect(() => {
    if (view?.status === "predict" || view?.status === "countdown") {
      setActiveMatch({ matchId, market, mode: "quick-play" });
    } else if (view?.status === "settled") {
      clearActiveMatch(matchId);
    }
  }, [view?.status, matchId, market]);

  useEffect(() => {
    if (gone) clearActiveMatch(matchId);
  }, [gone, matchId]);

  useEffect(() => {
    // Wait for Clerk to resolve and for the visitor to be signed in - the
    // match endpoints are auth-gated, and signing in via the modal below
    // should pick this loop back up rather than requiring a reload.
    if (!playerId || !isLoaded || !isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/match/${encodeURIComponent(matchId)}?playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        // Opponent left, or the match never existed - either way it is over.
        if (res.status === 404) return setGone("ended");
        if (res.status === 403) {
          if (!inviteJoin) return setGone("forbidden");
          const joinRes = await fetch(`/api/match/${encodeURIComponent(matchId)}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId }),
          });
          if (cancelled) return;
          if (joinRes.status === 404) return setGone("ended");
          if (joinRes.status === 409) return setGone("forbidden");
          if (!joinRes.ok) throw new Error("join failed");
        }
        if (res.ok) {
          const next = (await res.json()) as MatchView;
          if (cancelled) return;
          applyView(next);
          if (next.status === "settled") {
            window.dispatchEvent(new Event("balance-updated"));
          }
          if (next.status === "settled") return; // nothing left to change
        }
      } catch {
        // Transient failure: keep polling rather than dropping the player out.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchId, playerId, inviteJoin, applyView, isLoaded, isSignedIn]);

  // Seed the input from the live price once, so the spinner steps from the
  // current price instead of from 0.
  const seeded = useRef(false);
  useEffect(() => {
    if (price === null || seeded.current) return;
    seeded.current = true;
    setInput((prev) => (prev === "" ? price.toFixed(2) : prev));
  }, [price]);

  // Two fixed deadlines run through the same ticker: the 15s window to lock a
  // prediction, then the round itself. Both come from the server, corrected for
  // skew, so the two tabs count down to the same instant.
  const phase = view?.status;
  const deadline = !view
    ? null
    : phase === "predict"
      ? toLocal(view.lockDeadlineAt)
      : phase === "countdown"
        ? toLocal(view.deadlineAt)
        : null;
  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [deadline]);

  // Freeze the series the first time we see a settled result, pinning the final
  // point to the deadline rather than to whenever this tab noticed.
  useEffect(() => {
    if (!view || view.status !== "settled" || view.finalPrice === null) return;
    const finalPrice = view.finalPrice;
    const at = toLocal(view.deadlineAt) ?? Date.now();
    setFrozenPoints(
      (prev) => prev ?? [...pointsRef.current, { t: at, p: finalPrice }],
    );
  }, [view, toLocal]);

  const lock = async () => {
    if (!playerId || busy || view?.status !== "predict") return;
    const value = Number(input);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/match/${encodeURIComponent(matchId)}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, prediction: value }),
      });
      if (!res.ok) throw new Error("lock failed");
      applyView((await res.json()) as MatchView);
    } catch {
      setActionError("Could not lock that prediction. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await fetch(`/api/match/${encodeURIComponent(matchId)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
    } catch {
      // Best-effort; presence expiry covers a failed leave.
    }
    clearActiveMatch(matchId);
    router.push("/duel");
  };

  const nudge = (pct: number) => {
    if (price === null || view?.yourPrediction != null) return;
    const current = Number(input);
    const base = Number.isFinite(current) && current > 0 ? current : price;
    setInput((base * (1 + pct)).toFixed(2));
  };

  const predictionLines = useMemo<PredictionLine[]>(() => {
    if (!view) return [];
    const lines: PredictionLine[] = [];
    if (view.yourPrediction !== null) {
      lines.push({
        label: "You",
        value: view.yourPrediction,
        color: YOU_COLOR,
        at: toLocal(view.yourLockedAt),
      });
    }
    // Non-null from `countdown` on - withholding it is the server's job.
    if (view.opponentPrediction !== null) {
      lines.push({
        label: "Opp",
        value: view.opponentPrediction,
        color: OPP_COLOR,
        at: toLocal(view.opponentLockedAt),
      });
    }
    return lines;
  }, [view, toLocal]);

  const outcome =
    view &&
    view.status === "settled" &&
    view.finalPrice !== null &&
    view.yourPrediction !== null &&
    view.opponentPrediction !== null
      ? {
          finalPrice: view.finalPrice,
          winner: view.winner,
          yours: view.yourPrediction,
          opponents: view.opponentPrediction,
          yourDiff: Math.abs(view.finalPrice - view.yourPrediction),
          oppDiff: Math.abs(view.finalPrice - view.opponentPrediction),
        }
      : null;

  // The lock window ran out: whoever did lock wins by forfeit, and a round
  // nobody locked is void. Either way there is no final price to show.
  const expired = view?.status === "settled" && view.finalPrice === null;

  const marketLabel = market.toUpperCase();
  const headlinePrice = outcome ? outcome.finalPrice : price;
  // A deadline has passed but the server has not written the result yet.
  const settling = view?.status === "countdown" && secondsLeft === 0;
  const locking = view?.status === "predict" && secondsLeft === 0;
  const yourPrediction = view?.yourPrediction ?? null;
  const canEdit = view?.status === "predict" && yourPrediction === null;
  const compactCards =
    (view?.status === "countdown" || outcome !== null) &&
    yourPrediction !== null &&
    view?.opponentPrediction !== null;

  // Settled rounds compare against the final price; a live countdown compares
  // against the current tick so the cards update instead of sitting blank.
  const metricFor = (prediction: number) => {
    const reference = outcome ? outcome.finalPrice : view?.status === "countdown" ? price : null;
    if (reference === null) {
      return { call: "—", offBy: "—", error: "—" };
    }
    const offBy = Math.abs(reference - prediction);
    return {
      call: prediction >= reference ? "Above" : "Below",
      offBy: usd(offBy),
      error: `${((offBy / reference) * 100).toFixed(2)}%`,
    };
  };

  if (isLoaded && !isSignedIn) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-center">
        <h1 className="text-lg font-medium text-[var(--text)]">
          {inviteJoin ? "You've been invited to a duel" : "Sign in to view this match"}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {inviteJoin
            ? "Sign in and you'll join this duel automatically."
            : "Sign in to continue."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <SignInButton mode="modal">
            <button className="rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]">
              Sign in
            </button>
          </SignInButton>
          <Link
            href="/"
            className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
          >
            Back to lobby
          </Link>
        </div>
      </main>
    );
  }

  if (gone) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-center">
        <h1 className="text-lg font-medium text-[var(--text)]">
          {gone === "forbidden"
            ? "That match belongs to two other players."
            : "Match ended"}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {gone === "forbidden"
            ? "Start your own round from the lobby."
            : "Your opponent left before the round started, or the match no longer exists."}
        </p>
        <Link
          href="/duel"
          className="mt-6 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
        >
          Back to lobby
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/duel"
        className="text-xs uppercase tracking-wider text-[var(--muted-dim)] transition hover:text-[var(--text)]"
      >
        ← Menu
      </Link>

      <h1 className="mt-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        {marketLabel} Duel · Cast
        {view ? ` · ${view.wager} embers · ${view.timerSeconds}s` : ""}
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
                  status === "live"
                    ? "animate-pulse bg-[var(--accent)]"
                    : "bg-[var(--muted-dim)]"
                }`}
              />
              {status === "live" ? "live" : status}
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-semibold tabular-nums text-[var(--text)]">
          {headlinePrice === null ? "Loading…" : usd(headlinePrice)}
        </p>

        <div className="mt-4 flex min-h-16 flex-col items-center justify-center">
          {!view && <p className="text-sm text-[var(--muted)]">Loading match…</p>}
          {view?.status === "open" && (
            <>
              <p className="text-sm text-[var(--muted)]">Awaiting a challenger…</p>
              <p className="mt-1 text-xs text-[var(--muted-dim)]">
                Anyone picking {marketLabel} Cast at {view.wager} embers ·{" "}
                {view.timerSeconds}s joins you.
              </p>
            </>
          )}
          {view?.status === "predict" && !locking && (
            <>
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
                Lock in
              </p>
              <p
                className={`text-4xl font-semibold tabular-nums ${
                  (secondsLeft ?? 99) <= 5 ? "text-[var(--negative)]" : ""
                }`}
              >
                {secondsLeft ?? "—"}s
              </p>
              <p className="mt-1 text-xs text-[var(--muted-dim)]">
                {yourPrediction !== null
                  ? `Waiting on your opponent. The ${view.timerSeconds}-second round starts the moment they lock.`
                  : "Lock a prediction before this runs out, or you forfeit the round."}
              </p>
            </>
          )}
          {locking && (
            <p className="text-sm text-[var(--muted)]">Closing predictions…</p>
          )}
          {view?.status === "countdown" && !settling && (
            <>
              <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
                Time left
              </p>
              <p className="text-4xl font-semibold tabular-nums">
                {secondsLeft ?? "—"}s
              </p>
            </>
          )}
          {settling && (
            <p className="text-sm text-[var(--muted)]">Settling at the final price…</p>
          )}
        </div>
      </section>

      <section className="mt-2">
        <PriceChart
          points={frozenPoints ?? points}
          predictions={predictionLines}
          roundStart={view ? toLocal(view.roundStartAt) : null}
          frozen={frozenPoints !== null}
          now={now}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div
          className={`rounded-xl border bg-[var(--surface)] ${
            compactCards ? "p-3" : "p-5"
          } ${
            view?.winner === "you"
              ? "border-[var(--p1)] ring-1 ring-[var(--p1)]"
              : "border-[var(--line)]"
          }`}
        >
          {compactCards ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: YOU_COLOR }}
                  />
                  You
                </h2>
                <p className="text-lg font-semibold tabular-nums text-[var(--text)]">
                  {usd(yourPrediction)}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 text-xs">
                <div>
                  <dt className="text-[var(--muted)]">Call</dt>
                  <dd className="mt-1 font-medium text-[var(--text)]">{metricFor(yourPrediction).call}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Off by</dt>
                  <dd className="mt-1 font-medium tabular-nums text-[var(--text)]">{metricFor(yourPrediction).offBy}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Error</dt>
                  <dd className="mt-1 font-medium tabular-nums text-[var(--text)]">{metricFor(yourPrediction).error}</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <h2 className="flex items-center gap-2 font-medium text-[var(--text)]">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: YOU_COLOR }}
                />
                You
              </h2>

              <label className="mt-4 block text-xs uppercase tracking-wider text-[var(--muted)]">
                Prediction after {view?.timerSeconds ?? 60}s (USD)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={yourPrediction !== null ? String(yourPrediction) : input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") lock();
                }}
                disabled={!canEdit}
                placeholder={price !== null ? price.toFixed(2) : "0.00"}
                className="mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--field-bg)] px-3 py-2 text-lg text-[var(--text)] tabular-nums outline-none transition placeholder:text-[var(--muted-dim)] focus:border-[var(--accent)] disabled:bg-[var(--surface-raised)] disabled:text-[var(--muted-dim)]"
              />

              {canEdit && (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => nudge(-0.001)}
                      disabled={price === null}
                      className="rounded-md border border-[var(--line)] py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    >
                      -0.1%
                    </button>
                    <button
                      type="button"
                      onClick={() => nudge(0.001)}
                      disabled={price === null}
                      className="rounded-md border border-[var(--line)] py-1 text-xs font-medium text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    >
                      +0.1%
                    </button>
                  </div>
                  <button
                    onClick={lock}
                    disabled={busy || locking || !(Number(input) > 0)}
                    className="mt-3 w-full rounded-md bg-[var(--btn-bg)] px-3 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)] disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
                  >
                    {busy ? "Locking…" : "Lock Prediction"}
                  </button>
                </>
              )}

              {yourPrediction !== null && (
                <p className="mt-3 py-2 text-center text-sm font-medium text-[var(--accent)]">
                  Locked at {usd(yourPrediction)}
                </p>
              )}

              {actionError && (
                <p className="mt-1 text-center text-xs text-[var(--negative)]">
                  {actionError}
                </p>
              )}

              {outcome && (
                <dl className="mt-4 space-y-1 border-t border-[var(--line)] pt-4 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[var(--muted)]">Prediction</dt>
                    <dd className="tabular-nums">{usd(outcome.yours)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--muted)]">Off by</dt>
                    <dd className="tabular-nums">{usd(outcome.yourDiff)}</dd>
                  </div>
                </dl>
              )}
            </>
          )}
        </div>

        <div
          className={`rounded-xl border bg-[var(--surface)] ${
            compactCards ? "p-3" : "p-5"
          } ${
            view?.winner === "opponent"
              ? "border-[var(--p2)] ring-1 ring-[var(--p2)]"
              : "border-[var(--line)]"
          }`}
        >
          {compactCards ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: OPP_COLOR }}
                  />
                  Opponent
                </h2>
                <p className="text-lg font-semibold tabular-nums text-[var(--text)]">
                  {view?.opponentPrediction !== null && view?.opponentPrediction !== undefined
                    ? usd(view.opponentPrediction)
                    : "—"}
                </p>
              </div>
              {view?.opponentPrediction !== null && view?.opponentPrediction !== undefined && (
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 text-xs">
                  <div>
                    <dt className="text-[var(--muted)]">Call</dt>
                    <dd className="mt-1 font-medium text-[var(--text)]">{metricFor(view.opponentPrediction).call}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Off by</dt>
                    <dd className="mt-1 font-medium tabular-nums text-[var(--text)]">{metricFor(view.opponentPrediction).offBy}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Error</dt>
                    <dd className="mt-1 font-medium tabular-nums text-[var(--text)]">{metricFor(view.opponentPrediction).error}</dd>
                  </div>
                </dl>
              )}
            </>
          ) : (
            <>
              <h2 className="flex items-center justify-between font-medium text-[var(--text)]">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: OPP_COLOR }}
                  />
                  Opponent
                </span>
                {view?.opponentJoined && (
                  <span className="flex items-center gap-1.5 text-xs font-normal text-[var(--muted)]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        view.opponentPresent
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--muted-dim)]"
                      }`}
                    />
                    {view.opponentPresent ? "online" : "disconnected"}
                  </span>
                )}
              </h2>

              <div className="mt-4 min-h-24 text-sm text-[var(--muted)]">
                {!view && "…"}
                {view?.status === "open" && "No one has joined yet."}
                {view?.status === "predict" &&
                  (view.opponentLocked
                    ? "Locked in. Their number is revealed when the round starts."
                    : "Choosing a prediction…")}
                {view?.status === "countdown" && view.opponentPrediction !== null && (
                  <p className="text-lg font-medium tabular-nums text-[var(--text)]">
                    Locked at {usd(view.opponentPrediction)}
                  </p>
                )}
                {expired && view &&
                  (view.opponentPrediction !== null
                    ? `Locked at ${usd(view.opponentPrediction)} — but the round never ran.`
                    : "Never locked a prediction.")}
                {outcome && (
                  <dl className="space-y-1">
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted)]">Prediction</dt>
                      <dd className="tabular-nums text-[var(--text)]">
                        {usd(outcome.opponents)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted)]">Off by</dt>
                      <dd className="tabular-nums text-[var(--text)]">
                        {usd(outcome.oppDiff)}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>

              {view?.status === "predict" && !view.opponentPresent && (
                <p className="mt-2 text-xs text-[var(--muted-dim)]">
                  They have gone quiet. Wait, or leave and start a new match.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Bail-out only before the round starts; after that it settles regardless. */}
      {(view?.status === "open" || view?.status === "predict") && (
        <div className="mt-4 text-center">
          <button
            onClick={leave}
            disabled={busy}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            {view.status === "open" ? "Cancel match" : "Leave match"}
          </button>
        </div>
      )}

      {expired && view && (
        <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            Lock window closed
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {view.winner === "tie"
              ? "No result"
              : view.winner === "you"
                ? "You win by forfeit"
                : "Opponent wins by forfeit"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {view.winner === "tie"
              ? "Neither player locked a prediction in time, so nothing was settled."
              : view.winner === "you"
                ? "Your opponent ran out of time before locking a prediction."
                : "You ran out of time before locking a prediction."}
          </p>
          <Link
            href="/duel"
            className="mt-5 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
          >
            Play Again
          </Link>
        </section>
      )}

      {outcome && (
        <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">Winner</p>
          <p className="mt-1 text-2xl font-semibold">
            {outcome.winner === "tie"
              ? "Tie — identical predictions"
              : outcome.winner === "you"
                ? "You win"
                : "Opponent wins"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Final price {usd(outcome.finalPrice)} · you off by {usd(outcome.yourDiff)} ·
            opponent off by {usd(outcome.oppDiff)}
          </p>
          <Link
            href="/duel"
            className="mt-5 inline-block rounded-md bg-[var(--btn-bg)] px-5 py-2 text-sm font-medium text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)]"
          >
            Play Again
          </Link>
        </section>
      )}
    </main>
  );
}
