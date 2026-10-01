"use client";

import { useEffect, useState } from "react";
import { PORTFOLIO_LEVERAGE_OPTIONS, type PositionKind, type PositionSide } from "@/lib/portfolioRules";
import { CoinPicker } from "./CoinPicker";
import type { OpenPositionView, TokenSearchResult } from "./types";
import { CoinImage, EmberIcon, PriceChart, changeColor, compactUsd, num, pct, pnlColor, signed, useTokenHistory, usd } from "./ui";

const AMOUNT_PRESETS = [10, 25, 50, 100];
const QUOTE_REFRESH_MS = 5000;

export type TradeInput = {
  token: TokenSearchResult;
  kind: PositionKind;
  side: PositionSide | null;
  leverage: number | null;
  amount: number;
};

export function TradeTicket({
  availableCash,
  sessionEnded,
  busy,
  error,
  onSubmit,
  positions,
  closingId,
  onClose,
  recentAddresses,
}: {
  availableCash: number;
  sessionEnded: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (input: TradeInput) => Promise<boolean>;
  positions: OpenPositionView[];
  closingId: string | null;
  onClose: (id: string) => void;
  recentAddresses: string[];
}) {
  const [token, setToken] = useState<TokenSearchResult | null>(null);
  const [kind, setKind] = useState<PositionKind>("spot");
  const [spotAction, setSpotAction] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<PositionSide>("long");
  const [leverage, setLeverage] = useState<number>(PORTFOLIO_LEVERAGE_OPTIONS[0]);
  const [amountText, setAmountText] = useState("10");
  const [justOpened, setJustOpened] = useState<string | null>(null);

  // Keep the selected coin's price/24h change live while it's on screen.
  const tokenAddress = token?.address ?? null;
  useEffect(() => {
    if (!tokenAddress) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/tokens/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: [tokenAddress] }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tokens?: TokenSearchResult[] };
        const fresh = data.tokens?.[0];
        if (fresh && !cancelled) setToken((current) => (current?.address === fresh.address ? { ...current, ...fresh } : current));
      } catch {
        // Keep showing the last quote.
      }
    };
    const id = setInterval(refresh, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tokenAddress]);

  useEffect(() => {
    if (!justOpened) return;
    const id = setTimeout(() => setJustOpened(null), 3500);
    return () => clearTimeout(id);
  }, [justOpened]);

  const history = useTokenHistory(tokenAddress ? [tokenAddress] : []);

  const amount = Number.parseInt(amountText, 10) || 0;
  const maxAmount = Math.max(0, Math.floor(availableCash));
  const effectiveLeverage = kind === "leverage" ? leverage : 1;
  const isSell = kind === "spot" && spotAction === "sell";

  const disabledReason = sessionEnded
    ? "Session has ended"
    : !token
      ? "Select a coin"
      : amount <= 0
        ? "Enter an amount"
        : amount > maxAmount
          ? maxAmount === 0
            ? "No Embers available"
            : "Not enough Embers available"
          : busy
            ? "Opening position…"
            : null;
  const canSubmit = disabledReason === null;

  const submit = async () => {
    if (!token || !canSubmit) return;
    const ok = await onSubmit({
      token,
      kind,
      side: kind === "leverage" ? side : null,
      leverage: kind === "leverage" ? leverage : null,
      amount,
    });
    if (ok) setJustOpened(kind === "spot" ? `Bought ${num(amount)} Embers of ${token.symbol}` : `Opened ${token.symbol} ${side} · ${leverage}×`);
  };

  const actionLabel = !token ? "" : kind === "spot" ? `Buy ${token.symbol}` : `Open ${token.symbol} ${side === "long" ? "Long" : "Short"}`;
  const maxLossPrice =
    token && kind === "leverage"
      ? side === "long"
        ? token.priceUsd * (1 - 1 / leverage)
        : token.priceUsd * (1 + 1 / leverage)
      : null;
  const holdings = token ? positions.filter((p) => p.kind === "spot" && p.tokenAddress === token.address) : [];

  return (
    <section className="rounded-xl bg-[var(--surface)] p-4 sm:p-5" aria-label="Trade">
      <CoinPicker selected={token} onSelect={setToken} recentAddresses={recentAddresses} />

      {!token ? (
        <div className="mt-5 flex flex-col items-center rounded-xl bg-[var(--surface-raised)] px-6 py-10 text-center">
          <span className="flex -space-x-2" aria-hidden="true">
            <CoinImage src={null} symbol="?" size={36} />
            <CoinImage src={null} symbol="B" size={36} />
          </span>
          <p className="mt-3 text-sm font-medium text-[var(--text)]">Choose a Base coin to start building your portfolio.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Search above, or tap a trending coin.</p>
        </div>
      ) : (
        <>
          {/* Asset header */}
          <div className="mt-5 flex items-start gap-3">
            <CoinImage src={token.imageUrl} symbol={token.symbol} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold leading-tight text-[var(--text)]">{token.name}</h2>
                <span className="shrink-0 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Base
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {token.symbol}
                {token.marketCapUsd ? ` · MC ${compactUsd(token.marketCapUsd)}` : token.liquidityUsd > 0 ? ` · Liq ${compactUsd(token.liquidityUsd)}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold leading-tight tabular-nums text-[var(--text)]">{usd(token.priceUsd)}</p>
              <p className="text-xs tabular-nums" style={{ color: changeColor(token.change24h) }}>
                {token.change24h === null ? "24h —" : `${pct(token.change24h)} 24h`}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <PriceChart values={history.lookup(token.address)} loading={history.loading} />
          </div>

          {/* Trade type */}
          <div className="mt-5 flex gap-6 border-b border-[color-mix(in_srgb,var(--line)_70%,transparent)]" role="tablist" aria-label="Trade type">
            {(["spot", "leverage"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={kind === option}
                onClick={() => setKind(option)}
                className={`-mb-px min-h-11 border-b-2 text-sm font-semibold transition ${
                  kind === option ? "border-[var(--brand)] text-[var(--text)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {option === "spot" ? "Spot" : "Leverage"}
              </button>
            ))}
          </div>

          {kind === "spot" ? (
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-[var(--field-bg)] p-1" role="group" aria-label="Spot action">
              {(["buy", "sell"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={spotAction === option}
                  onClick={() => setSpotAction(option)}
                  className={`min-h-10 rounded-md text-sm font-semibold transition ${
                    spotAction === option ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {option === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
                {(["long", "short"] as const).map((option) => {
                  const selected = side === option;
                  const tone = option === "long" ? "var(--positive)" : "var(--negative)";
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSide(option)}
                      style={
                        selected
                          ? { color: tone, boxShadow: `inset 0 0 0 1.5px ${tone}`, backgroundColor: `color-mix(in srgb, ${tone} 10%, var(--surface-raised))` }
                          : undefined
                      }
                      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${
                        selected ? "" : "bg-[var(--surface-raised)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      }`}
                    >
                      {option === "long" ? "Long ↗" : "Short ↘"}
                    </button>
                  );
                })}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Leverage</p>
                <div className="pf-scroll-x mt-1.5 flex gap-2 overflow-x-auto" role="group" aria-label="Leverage">
                  {PORTFOLIO_LEVERAGE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={leverage === option}
                      onClick={() => setLeverage(option)}
                      className={`min-h-11 min-w-14 flex-1 rounded-lg text-sm font-semibold tabular-nums transition ${
                        leverage === option
                          ? "bg-[var(--selected-bg)] text-[var(--brand-strong)] ring-1 ring-[var(--brand)]"
                          : "bg-[var(--surface-raised)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      }`}
                    >
                      {option}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isSell ? (
            <SellHoldings token={token} holdings={holdings} closingId={closingId} onClose={onClose} />
          ) : (
            <>
              {/* Amount */}
              <div className="mt-5">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="pf-amount" className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Amount
                  </label>
                  <span className="flex items-center gap-1 text-xs tabular-nums text-[var(--muted)]">
                    <EmberIcon className="h-3 w-3" />
                    <span className="text-[var(--text)]">{num(maxAmount)}</span> Embers available
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {[...AMOUNT_PRESETS, maxAmount].map((preset, i) => {
                    const isMax = i === AMOUNT_PRESETS.length;
                    return (
                      <button
                        key={isMax ? "max" : preset}
                        type="button"
                        disabled={preset <= 0 || preset > maxAmount}
                        aria-pressed={amount === preset}
                        onClick={() => setAmountText(String(preset))}
                        className={`min-h-11 rounded-lg text-sm font-semibold tabular-nums transition disabled:cursor-not-allowed disabled:opacity-35 ${
                          amount === preset
                            ? "bg-[var(--selected-bg)] text-[var(--brand-strong)] ring-1 ring-[var(--brand)]"
                            : "bg-[var(--surface-raised)] text-[var(--muted)] enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text)]"
                        }`}
                      >
                        {isMax ? "Max" : preset}
                      </button>
                    );
                  })}
                </div>
                <div className="relative mt-2">
                  <input
                    id="pf-amount"
                    value={amountText}
                    onChange={(event) => setAmountText(event.target.value.replace(/\D/g, "").slice(0, 9))}
                    inputMode="numeric"
                    placeholder="Custom amount"
                    aria-invalid={amount > maxAmount}
                    className={`min-h-11 w-full rounded-lg bg-[var(--field-bg)] py-2.5 pl-3 pr-20 text-base font-semibold tabular-nums text-[var(--text)] outline-none ring-1 transition placeholder:font-normal placeholder:text-[var(--muted-dim)] focus:ring-[var(--brand)] ${
                      amount > maxAmount ? "ring-[var(--negative)]" : "ring-transparent hover:ring-[var(--line)]"
                    }`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">Embers</span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, maxAmount)}
                    step={1}
                    value={Math.min(amount, maxAmount)}
                    disabled={maxAmount === 0}
                    onChange={(event) => setAmountText(event.target.value)}
                    aria-label="Share of available Embers"
                    aria-valuetext={`${num(Math.min(amount, maxAmount))} Embers`}
                    className="pf-range flex-1"
                    style={{ ["--pf-fill" as string]: `${maxAmount > 0 ? (Math.min(amount, maxAmount) / maxAmount) * 100 : 0}%` }}
                  />
                  <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-[var(--muted)]">
                    {maxAmount > 0 ? `${Math.round((Math.min(amount, maxAmount) / maxAmount) * 100)}%` : "0%"} of available
                  </span>
                </div>
              </div>

              {/* Summary */}
              <dl className="mt-5 space-y-2 rounded-xl bg-[var(--surface-raised)] p-3.5 text-sm">
                <SummaryRow
                  label="Position size"
                  value={
                    kind === "spot"
                      ? `${num(amount)} Embers${token.priceUsd > 0 && amount > 0 ? ` · ≈${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(amount / token.priceUsd)} ${token.symbol}` : ""}`
                      : `${num(amount * effectiveLeverage)} Embers exposure`
                  }
                />
                <SummaryRow label="Leverage" value={kind === "spot" ? "None (spot)" : `${leverage}× ${side === "long" ? "long" : "short"}`} />
                <SummaryRow label="Maximum loss" value={`${num(amount)} Embers`} />
                <SummaryRow
                  label="Remaining available"
                  value={`${num(Math.max(0, maxAmount - amount))} Embers`}
                  warn={amount > maxAmount}
                />
                {maxLossPrice !== null && (
                  <SummaryRow label="Max loss reached at" value={maxLossPrice <= 0 ? "Only if price hits $0" : usd(maxLossPrice)} />
                )}
              </dl>

              {/* Submit */}
              <div className={canSubmit ? "pf-sticky-submit" : ""}>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submit}
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--btn-bg)] px-4 text-base font-semibold text-[var(--btn-text)] transition hover:bg-[var(--btn-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
                >
                  {canSubmit && <CoinImage src={token.imageUrl} symbol={token.symbol} size={22} />}
                  {disabledReason ?? actionLabel}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <div aria-live="polite">
        {error && (
          <p className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] px-3 py-2 text-center text-xs text-[var(--negative)]" role="alert">
            {error}
          </p>
        )}
        {justOpened && !error && <p className="mt-3 text-center text-xs text-[var(--brand-strong)]">{justOpened} ✓</p>}
      </div>
    </section>
  );
}

function SummaryRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-medium tabular-nums" style={{ color: warn ? "var(--negative)" : "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}

function SellHoldings({
  token,
  holdings,
  closingId,
  onClose,
}: {
  token: TokenSearchResult;
  holdings: OpenPositionView[];
  closingId: string | null;
  onClose: (id: string) => void;
}) {
  if (holdings.length === 0) {
    return (
      <div className="mt-4 rounded-xl bg-[var(--surface-raised)] px-4 py-6 text-center">
        <p className="text-sm text-[var(--text)]">You don’t hold any {token.symbol} yet.</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Buy first — each spot buy can be sold back in full at the live price.</p>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-[var(--muted)]">Each buy is its own lot and sells in full at the live price.</p>
      {holdings.map((lot) => (
        <div key={lot.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-raised)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium tabular-nums text-[var(--text)]">{num(lot.committedCash)} Embers in</p>
            <p className="text-xs tabular-nums text-[var(--muted)]">Bought at {usd(lot.entryPrice)}</p>
          </div>
          <p className="text-sm font-semibold tabular-nums" style={{ color: pnlColor(lot.unrealizedPnl) }}>
            {signed(lot.unrealizedPnl)}
          </p>
          <button
            type="button"
            disabled={closingId !== null}
            onClick={() => onClose(lot.id)}
            className="min-h-11 rounded-lg bg-[var(--surface-hover)] px-4 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--line)] disabled:opacity-50"
          >
            {closingId === lot.id ? "Selling…" : "Sell"}
          </button>
        </div>
      ))}
    </div>
  );
}
