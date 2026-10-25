"use client";

import { useEffect, useRef, useState } from "react";
import { DepositIcon, SendIcon, SwapIcon } from "@/app/icons";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const signedUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

/**
 * Total balance with only the changed digits briefly tinted on update — same
 * diffing technique as app/duel/portfolio/ui.tsx's LivePrice, generalized for
 * a compact-formatted total instead of a token price.
 */
function AnimatedTotal({ value }: { value: number }) {
  const text = usd(value);
  const previous = useRef(text);
  const [change, setChange] = useState<{ from: number; dir: "up" | "down"; key: number } | null>(null);

  useEffect(() => {
    const prev = previous.current;
    if (prev === text) return;
    let from = 0;
    while (from < text.length && text[from] === prev[from]) from++;
    previous.current = text;
    setChange({ from, dir: text.length >= prev.length && text > prev ? "up" : "down", key: Date.now() });
    const id = setTimeout(() => setChange(null), 900);
    return () => clearTimeout(id);
  }, [text]);

  return (
    <span className="wd-chip-total tabular-nums" aria-label={text}>
      {text.split("").map((char, i) => {
        const tinted = change !== null && i >= change.from && /\d/.test(char);
        return (
          <span key={tinted ? `${i}-${change!.key}` : i} aria-hidden="true" className={tinted ? `wd-digit-${change!.dir}` : undefined}>
            {char}
          </span>
        );
      })}
    </span>
  );
}

/** Big centerpiece balance card — dotted backdrop, large total, 24h change, Swap/Send/Deposit tiles (Coinbase Wallet home layout). */
export function BalanceChip({
  totalUsd,
  changeUsd,
  changePct,
  onDeposit,
  onSend,
  onSwap,
}: {
  totalUsd: number;
  changeUsd: number | null;
  changePct: number | null;
  onDeposit: () => void;
  onSend: () => void;
  onSwap: () => void;
}) {
  const flat = changePct === null || Math.abs(changePct) < 0.005;
  const color = flat ? "var(--muted)" : (changePct ?? 0) > 0 ? "var(--positive)" : "var(--negative)";

  return (
    <section className="wd-chip" aria-label="Wallet balance">
      <span className="wd-chip-grid" aria-hidden="true" />
      <AnimatedTotal value={totalUsd} />
      <p className="wd-chip-change" style={{ color }}>
        {changeUsd === null || changePct === null ? "—" : <>{signedUsd(changeUsd)} <span>({signedPct(changePct)}) today</span></>}
      </p>
      <div className="wd-chip-tiles">
        <button type="button" onClick={onSwap} className="wd-tile">
          <span className="wd-tile-icon"><SwapIcon className="h-5 w-5" /></span>
          Swap
        </button>
        <button type="button" onClick={onSend} className="wd-tile">
          <span className="wd-tile-icon"><SendIcon className="h-5 w-5" /></span>
          Send
        </button>
        <button type="button" onClick={onDeposit} className="wd-tile">
          <span className="wd-tile-icon"><DepositIcon className="h-5 w-5" /></span>
          Deposit
        </button>
      </div>
    </section>
  );
}
