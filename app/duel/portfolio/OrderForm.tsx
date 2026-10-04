"use client";

import { useEffect, useState } from "react";
import { PORTFOLIO_LEVERAGE_OPTIONS, type PositionKind, type PositionSide } from "@/lib/portfolioRules";
import type { TokenSearchResult } from "./types";
import { CoinImage, EmberIcon, num } from "./ui";

const AMOUNT_PRESETS = [10, 25, 50, 100];

export type TradeInput = {
  token: TokenSearchResult;
  kind: PositionKind;
  side: PositionSide | null;
  leverage: number | null;
  amount: number;
};

/**
 * The compact order form: Spot / Leverage tabs, one amount field with a few
 * presets, a short summary, one submit button. Selling/closing lives on the
 * position cards in the portfolio column.
 */
export function OrderForm({
  token,
  availableCash,
  sessionEnded,
  busy,
  error,
  onSubmit,
  onViewPortfolio,
}: {
  token: TokenSearchResult;
  availableCash: number;
  sessionEnded: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: TradeInput) => Promise<boolean>;
  /** Mobile only: jump to the Portfolio tab after a fill. */
  onViewPortfolio?: () => void;
}) {
  const [kind, setKind] = useState<PositionKind>("spot");
  const [side, setSide] = useState<PositionSide>("long");
  const [leverage, setLeverage] = useState<number>(PORTFOLIO_LEVERAGE_OPTIONS[0]);
  const [amountText, setAmountText] = useState("25");
  const [filled, setFilled] = useState<string | null>(null);

  useEffect(() => setFilled(null), [token.address]);
  useEffect(() => {
    if (!filled) return;
    const id = setTimeout(() => setFilled(null), 5000);
    return () => clearTimeout(id);
  }, [filled]);

  const amount = Number.parseInt(amountText, 10) || 0;
  const maxAmount = Math.max(0, Math.floor(availableCash));
  const isLeverage = kind === "leverage";

  const disabledReason = sessionEnded
    ? "Session has ended"
    : token.priceUsd <= 0
      ? "Price unavailable"
      : amount <= 0
        ? "Enter an amount"
        : amount > maxAmount
          ? maxAmount === 0
            ? "No Embers available"
            : "Not enough Embers available"
          : null;
  const canSubmit = disabledReason === null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setFilled(null);
    const ok = await onSubmit({ token, kind, side: isLeverage ? side : null, leverage: isLeverage ? leverage : null, amount });
    if (ok) {
      setFilled(isLeverage ? `${side === "long" ? "Long" : "Short"} ${token.symbol} ${leverage}× opened with ${num(amount)} Embers` : `Bought ${num(amount)} Embers of ${token.symbol}`);
    }
  };

  const actionLabel = isLeverage ? `${side === "long" ? "Long" : "Short"} ${token.symbol} ${leverage}×` : `Buy ${token.symbol}`;

  return (
    <section aria-label="Place an order" className="rounded-xl bg-[var(--surface-raised)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-5 border-b border-[color-mix(in_srgb,var(--line)_70%,transparent)]" role="tablist" aria-label="Order type">
          {(["spot", "leverage"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              onClick={() => setKind(option)}
              className={`-mb-px min-h-10 border-b-2 text-sm font-semibold transition-colors ${
                kind === option ? "border-[var(--brand)] text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {option === "spot" ? "Spot" : "Leverage"}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1 text-xs tabular-nums text-[var(--muted)]">
          <EmberIcon className="h-3 w-3" />
          <span className="text-[var(--text)]">{num(maxAmount)}</span> available
        </span>
      </div>

      {isLeverage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-[var(--field-bg)] p-1" role="group" aria-label="Direction">
            {(["long", "short"] as const).map((option) => {
              const on = side === option;
              const tone = option === "long" ? "var(--positive)" : "var(--negative)";
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSide(option)}
                  style={on ? { color: tone, backgroundColor: `color-mix(in srgb, ${tone} 14%, var(--surface-raised))` } : undefined}
                  className={`min-h-9 rounded-md text-sm font-semibold transition-colors ${on ? "" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                >
                  {option === "long" ? "Long ▲" : "Short ▼"}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1" role="group" aria-label="Leverage">
            {PORTFOLIO_LEVERAGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={leverage === option}
                onClick={() => setLeverage(option)}
                className={`min-h-9 min-w-10 rounded-md text-xs font-semibold tabular-nums transition-colors ${
                  leverage === option
                    ? "bg-[var(--selected-bg)] text-[var(--brand-strong)] ring-1 ring-[var(--brand)]"
                    : "bg-[var(--field-bg)] text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <label htmlFor="pf-amount" className="sr-only">
          Amount in Embers
        </label>
        <div className="relative">
          <input
            id="pf-amount"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            placeholder="Amount"
            aria-invalid={amount > maxAmount}
            className={`min-h-11 w-full rounded-lg bg-[var(--field-bg)] py-2.5 pl-3 pr-20 text-base font-semibold tabular-nums text-[var(--text)] outline-none ring-1 transition placeholder:font-normal placeholder:text-[var(--muted-dim)] focus:ring-[var(--brand)] ${
              amount > maxAmount ? "ring-[var(--negative)]" : "ring-transparent hover:ring-[var(--line)]"
            }`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">Embers</span>
        </div>
        <div className="mt-1.5 flex gap-1">
          {[...AMOUNT_PRESETS, maxAmount].map((preset, i) => {
            const isMax = i === AMOUNT_PRESETS.length;
            return (
              <button
                key={isMax ? "max" : preset}
                type="button"
                disabled={preset <= 0 || preset > maxAmount}
                aria-pressed={amount === preset}
                onClick={() => setAmountText(String(preset))}
                className={`min-h-8 flex-1 rounded-md text-xs font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  amount === preset ? "bg-[var(--selected-bg)] text-[var(--brand-strong)]" : "text-[var(--muted)] enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text)]"
                }`}
              >
                {isMax ? "Max" : preset}
              </button>
            );
          })}
        </div>
      </div>

      <div className={canSubmit || busy ? "pf-sticky-submit" : ""}>
        <button
          type="button"
          disabled={!canSubmit}
          aria-busy={busy}
          onClick={submit}
          className={`pf-submit mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
            busy
              ? "cursor-progress bg-[var(--btn-bg)] text-[var(--btn-text)] opacity-80"
              : "bg-[var(--btn-bg)] text-[var(--btn-text)] hover:bg-[var(--btn-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
          }`}
        >
          {busy ? (
            <>
              <span className="pf-spinner" aria-hidden="true" />
              Placing order…
            </>
          ) : (
            <>
              {canSubmit && <CoinImage src={token.imageUrl} symbol={token.symbol} size={22} />}
              {disabledReason ?? actionLabel}
            </>
          )}
        </button>
      </div>

      <div aria-live="polite">
        {error && (
          <p className="mt-2.5 rounded-lg bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] px-3 py-2 text-center text-xs text-[var(--negative)]" role="alert">
            {error}
          </p>
        )}
        {filled && !error && (
          <p className="mt-2.5 flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]">
            <span>Order filled · {filled}</span>
            {onViewPortfolio && (
              <button type="button" onClick={onViewPortfolio} className="font-semibold text-[var(--brand-strong)] lg:hidden">
                View position
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
