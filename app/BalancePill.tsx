"use client";

import { useEffect, useState } from "react";
import { formatEth, getWalletProvider } from "@/app/lib/wallet";

export function BalancePill() {
  const [balance, setBalance] = useState<number | null>(null);
  const [walletUsd, setWalletUsd] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/balance")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.balance === "number") setBalance(data.balance);
      });
    refresh();
    const refreshWalletValue = async () => {
      const provider = getWalletProvider();
      if (!provider) return setWalletUsd(null);
      try {
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (!accounts[0]) return setWalletUsd(null);
        const [rawBalance, priceResponse] = await Promise.all([
          provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as Promise<string>,
          fetch("/api/price?symbol=ETH-USD", { cache: "no-store" }),
        ]);
        const price = (await priceResponse.json()) as { price?: number };
        if (typeof price.price === "number") setWalletUsd(Number(formatEth(rawBalance)) * price.price);
      } catch { setWalletUsd(null); }
    };
    void refreshWalletValue();
    window.addEventListener("wallet-updated", refreshWalletValue);
    window.addEventListener("balance-updated", refresh);
    return () => { cancelled = true; window.removeEventListener("wallet-updated", refreshWalletValue); window.removeEventListener("balance-updated", refresh); };
  }, []);

  return (
    <span className="balance-display">
      <span className="header-balance-block"><span className="balance-label">USD</span><span className="tabular-nums">{walletUsd === null ? "—" : `$${walletUsd.toFixed(2)}`}</span></span>
      <span className="header-balance-block"><span className="balance-label">Embers</span><span className="tabular-nums">{balance === null ? "—" : balance}</span></span>
    </span>
  );
}
