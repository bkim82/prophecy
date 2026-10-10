"use client";

import { useEffect, useRef, useState } from "react";
import { chainName, formatEth, getWalletProvider, isBaseChain, switchToBase, type EthereumProvider } from "@/app/lib/wallet";

export type WalletState = { address: string | null; chainId: string | null; chain: string | null; balance: string | null };
export const EMPTY_WALLET: WalletState = { address: null, chainId: null, chain: null, balance: null };

/**
 * Coinbase Wallet SDK connect/disconnect/switch state machine, shared by
 * every surface that needs a connected wallet (the wallet dashboard,
 * WalletDesk). Pulled out of app/WalletDesk.tsx so the handshake-race
 * handling below has exactly one copy.
 */
export function useWalletConnection() {
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Coinbase Wallet SDK's Smart Wallet signer throws (code 4100) if `eth_accounts` is
  // called before `eth_requestAccounts` has ever succeeded this session, and it also
  // can't handle a second request while one is already in flight — set while a
  // connect/switch handshake is running so the chainChanged listener doesn't race it.
  const handshakeInFlight = useRef(false);

  const refreshWallet = async (provider: EthereumProvider, address?: string) => {
    let accounts: string[];
    if (address) {
      accounts = [address];
    } else {
      try { accounts = await provider.request({ method: "eth_accounts" }) as string[]; }
      catch { setWallet(EMPTY_WALLET); return; }
    }
    if (!accounts[0]) { setWallet(EMPTY_WALLET); return; }
    let chainId: string;
    let balance: string;
    try {
      chainId = await provider.request({ method: "eth_chainId" }) as string;
      balance = await provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
    } catch { return; } // mid-handshake race (SDK not yet marked authorized) — the next event/poll retries
    const eth = formatEth(balance);
    setWallet({ address: accounts[0], chainId, chain: chainName(chainId), balance: eth });
    window.dispatchEvent(new Event("wallet-updated"));
  };

  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    void refreshWallet(provider);
    const onAccountsChanged = (...args: unknown[]) => { if (!handshakeInFlight.current) void refreshWallet(provider, (args[0] as string[])[0]); };
    const onChainChanged = () => { if (!handshakeInFlight.current) void refreshWallet(provider); };
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => { provider.removeListener?.("accountsChanged", onAccountsChanged); provider.removeListener?.("chainChanged", onChainChanged); };
  }, []);

  const connect = async () => {
    const provider = getWalletProvider();
    if (!provider) { setNotice("Wallet connection isn't available right now."); return; }
    setConnecting(true); setNotice(null); handshakeInFlight.current = true;
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      await refreshWallet(provider, accounts[0]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Wallet connection was cancelled."); }
    finally { setConnecting(false); handshakeInFlight.current = false; }
  };

  const disconnectWallet = async () => {
    const provider = getWalletProvider();
    if (provider) { try { await provider.disconnect?.(); } catch { /* already disconnected */ } }
    setWallet(EMPTY_WALLET);
    setNotice(null);
    window.dispatchEvent(new Event("wallet-updated"));
  };

  const switchWallet = async () => {
    const provider = getWalletProvider();
    if (!provider) return;
    try { await provider.disconnect?.(); } catch { /* already disconnected */ }
    setWallet(EMPTY_WALLET);
    await connect();
  };

  const switchNetwork = async () => {
    const provider = getWalletProvider();
    if (!provider) return;
    setSwitching(true); setNotice(null); handshakeInFlight.current = true;
    try { await switchToBase(provider); await refreshWallet(provider); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Couldn't switch to Base. Switch networks from your wallet instead."); }
    finally { setSwitching(false); handshakeInFlight.current = false; }
  };

  return {
    wallet,
    notice,
    setNotice,
    connecting,
    switching,
    isBaseChain: wallet.chainId ? isBaseChain(wallet.chainId) : false,
    connect,
    disconnectWallet,
    switchWallet,
    switchNetwork,
  };
}
