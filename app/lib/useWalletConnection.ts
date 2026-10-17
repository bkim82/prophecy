"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import { formatEth } from "@/app/lib/wallet";

export type WalletState = {
  address: string | null;
  chainId: number | null;
  chain: "Base" | null;
  balance: string | null;
};

/**
 * Provider-neutral wallet identity. The address and chain come only from the
 * validated Prophecy application session; the balance is a public chain read.
 */
export function useWalletIdentity() {
  const { isLoaded, isSignedIn, openSignIn, signOut, user } = useAppAuth();
  const [rawBalance, setRawBalance] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const address = user?.smartAccountAddress ?? null;
  const chainId = user?.walletChainId ?? null;

  useEffect(() => {
    if (!address || chainId !== 8453) {
      queueMicrotask(() => setRawBalance(null));
      return;
    }
    let cancelled = false;
    const load = () => fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the wallet balance.");
        return response.json() as Promise<{ balance: string }>;
      })
      .then((body) => { if (!cancelled) setRawBalance(body.balance); })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setRawBalance(null);
          setNotice(cause instanceof Error ? cause.message : "Could not load the wallet balance.");
        }
      });
    void load();
    const id = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [address, chainId]);

  const wallet = useMemo<WalletState>(() => ({
    address,
    chainId,
    chain: chainId === 8453 ? "Base" : null,
    balance: rawBalance === null ? null : formatEth(rawBalance),
  }), [address, chainId, rawBalance]);

  return {
    wallet,
    notice,
    setNotice,
    isLoaded,
    isSignedIn,
    signIn: openSignIn,
    signOut,
  };
}
