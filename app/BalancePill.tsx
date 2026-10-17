"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { FlameIcon } from "@/app/icons";
import { formatEth } from "@/app/lib/wallet";

/**
 * One compact header control: the Embers balance up front, with the
 * connected wallet's USD value tucked into a dropdown.
 */
export function BalancePill() {
  const { user } = useAppAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [walletUsd, setWalletUsd] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/balance")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.balance === "number") setBalance(data.balance);
      });
    refresh();
    const refreshWalletValue = async () => {
      const address = user?.smartAccountAddress;
      if (!address || user.walletChainId !== 8453) return setWalletUsd(null);
      try {
        const [balanceResponse, priceResponse] = await Promise.all([
          fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`, { cache: "no-store" }),
          fetch("/api/price?symbol=ETH-USD", { cache: "no-store" }),
        ]);
        if (!balanceResponse.ok) throw new Error("Balance unavailable");
        const rawBalance = (await balanceResponse.json() as { balance: string }).balance;
        const price = (await priceResponse.json()) as { price?: number };
        if (typeof price.price === "number") setWalletUsd(Number(formatEth(rawBalance)) * price.price);
      } catch { setWalletUsd(null); }
    };
    void refreshWalletValue();
    window.addEventListener("wallet-updated", refreshWalletValue);
    window.addEventListener("balance-updated", refresh);
    return () => { cancelled = true; window.removeEventListener("wallet-updated", refreshWalletValue); window.removeEventListener("balance-updated", refresh); };
  }, [user?.smartAccountAddress, user?.walletChainId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const embers = balance === null ? "—" : balance.toLocaleString("en-US");

  return (
    <div ref={rootRef} className="balance-menu">
      <button
        type="button"
        className="balance-display"
        aria-label={`${embers} Embers — show balances`}
        aria-expanded={open}
        aria-controls="balance-menu-popover"
        onClick={() => setOpen((value) => !value)}
      >
        <FlameIcon className="balance-ember-icon" />
        <span className="tabular-nums">{embers}</span>
        <svg className="balance-caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4" /></svg>
      </button>
      {open && (
        <div id="balance-menu-popover" className="balance-menu-popover" role="dialog" aria-label="Balances">
          <dl>
            <div><dt><FlameIcon className="balance-ember-icon" /> Embers</dt><dd className="tabular-nums">{embers}</dd></div>
            <div><dt>Wallet (USD)</dt><dd className="tabular-nums">{walletUsd === null ? "Unavailable" : `$${walletUsd.toFixed(2)}`}</dd></div>
          </dl>
          <Link href="/wallet" className="balance-menu-link" onClick={() => setOpen(false)}>Open wallet <span aria-hidden="true">→</span></Link>
        </div>
      )}
    </div>
  );
}
