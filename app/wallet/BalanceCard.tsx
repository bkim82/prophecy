"use client";

import { useEffect, useRef, useState } from "react";
import { CoinImage } from "@/app/duel/portfolio/ui";
import { walletFreeGasEnabled } from "@/app/lib/embeddedWallet/config";

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
    <span className="wd-balance-total" aria-label={text}>
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

export type WalletMenuItem = { label: string; onSelect: () => void };

export type BalanceChip = {
  label: string;
  symbol: string;
  usdValue: number;
  imageUrl: string | null;
  /** Opens the coin's detail panel; omitted when the wallet doesn't hold it. */
  onSelect?: () => void;
};

/**
 * Balance card: available total (blank until the first holdings read, so a
 * not-yet-loaded wallet never flashes $0.00), Deposit/Withdraw, a ⋯ menu for
 * the less common actions, and a stats row under a divider. Chips at the right
 * end of that row (Gas = ETH, Cash = USDC, the wallet's default asset) call out
 * the balances the wallet runs on.
 */
export function BalanceCard({
  totalUsd,
  chips,
  loaded,
  subline,
  changeUsd,
  changePct,
  onDeposit,
  onWithdraw,
  menu,
}: {
  totalUsd: number;
  chips: BalanceChip[];
  loaded: boolean;
  subline: string;
  changeUsd: number | null;
  changePct: number | null;
  onDeposit: () => void;
  onWithdraw: () => void;
  menu: WalletMenuItem[];
}) {
  // Sub-cent moves (a stablecoin's drift) read as flat, not as a green "+$0.00".
  const flat = changePct === null || changeUsd === null || Math.abs(changePct) < 0.005 || Math.abs(changeUsd) < 0.005;
  const tone = flat ? "" : (changePct ?? 0) > 0 ? "is-up" : "is-down";

  return (
    <section className="wd-balance" aria-label="Wallet balance">
      <div className="wd-balance-top">
        <div className="wd-balance-figure">
          <span className="wd-balance-label">Available balance</span>
          {loaded ? <AnimatedTotal value={totalUsd} /> : <span className="wd-balance-total wd-balance-loading" aria-label="Loading balance">$—</span>}
          <span className="wd-balance-sub">{loaded ? subline : "Reading balances from Base…"}</span>
        </div>
        <div className="wd-balance-actions">
          <button type="button" className="wd-pill wd-pill-primary" onClick={onDeposit}>
            <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M7 2v10M2 7h10" /></svg>
            Deposit
          </button>
          <button type="button" className="wd-pill" onClick={onWithdraw}>
            <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" /></svg>
            Withdraw
          </button>
          <WalletMenu items={menu} />
        </div>
      </div>
      <div className="wd-balance-foot">
        <dl className="wd-balance-stats">
          <div>
            <dt>24h change</dt>
            <dd className={tone}>{!loaded || changeUsd === null || changePct === null ? "—" : `${signedUsd(changeUsd)} (${signedPct(changePct)})`}</dd>
          </div>
          <div>
            <dt>Network fees</dt>
            <dd>{walletFreeGasEnabled() ? "Covered by Prophecy" : "Paid from balance"}</dd>
          </div>
        </dl>
        {loaded && (
          <div className="wd-asset-chips">
            {chips.map((chip) => <AssetChip key={chip.label} chip={chip} />)}
          </div>
        )}
      </div>
    </section>
  );
}

/** A tinted stat (label over value, like its neighbours); opens the coin's detail panel when held. */
function AssetChip({ chip }: { chip: BalanceChip }) {
  const body = (
    <>
      <CoinImage src={chip.imageUrl} symbol={chip.symbol} size={28} />
      <span className="wd-asset-chip-text">
        <span className="wd-asset-chip-label">{chip.label}</span>
        <span className="wd-asset-chip-value"><strong>{usd(chip.usdValue)}</strong> <small>{chip.symbol}</small></span>
      </span>
    </>
  );
  return chip.onSelect ? (
    <button type="button" className="wd-asset-chip" onClick={chip.onSelect} aria-label={`${chip.label}: ${usd(chip.usdValue)} ${chip.symbol}. View details`}>
      {body}
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>
    </button>
  ) : (
    <span className="wd-asset-chip">{body}</span>
  );
}

// Same open/blur/Escape handling as app/PostMenu.tsx, reusing its dropdown styles.
function WalletMenu({ items }: { items: WalletMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  return (
    <div
      className="post-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="wd-pill wd-pill-round"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More wallet actions"
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </button>
      {open && (
        <div className="post-menu-dropdown" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
