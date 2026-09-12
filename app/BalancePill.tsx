"use client";

import { useEffect, useState } from "react";

export function BalancePill() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/balance")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.balance === "number") setBalance(data.balance);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <span className="balance-display">
      <span className="balance-label">Balance</span>
      <span className="tabular-nums">{balance === null ? "—" : balance}</span>
      <span className="balance-label">coins</span>
    </span>
  );
}
