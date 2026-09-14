"use client";

import { useEffect, useState } from "react";

export function BalancePill() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/balance")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.balance === "number") setBalance(data.balance);
      });
    refresh();
    window.addEventListener("balance-updated", refresh);
    return () => { cancelled = true; window.removeEventListener("balance-updated", refresh); };
  }, []);

  return (
    <span className="balance-display">
      <span className="balance-label">Balance</span>
      <span className="tabular-nums">{balance === null ? "—" : balance}</span>
      <span className="balance-label">coins</span>
    </span>
  );
}
