// Alchemy wrapper for a connected wallet's real Base ERC-20 holdings. The public Base
// RPC has no way to enumerate "every token this address holds" — that needs an indexer,
// so this is the one place in the app that talks to Alchemy instead of a public RPC.
// Requires ALCHEMY_API_KEY (free tier: alchemy.com -> create a Base Mainnet app).
// Never throws: returns [] (or the last cached result) on any failure, same invariant
// as lib/basePrices.ts.

import { getTokenSummaries } from "./basePrices";

const BALANCE_TTL_MS = 15_000;
const MAX_TOKENS = 25;

export type WalletTokenHolding = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
  imageUrl: string | null;
};

type CacheEntry = { at: number; holdings: WalletTokenHolding[] };
const cache = new Map<string, CacheEntry>();

const rpcUrl = () => {
  const key = process.env.ALCHEMY_API_KEY;
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : null;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = rpcUrl();
  if (!url) throw new Error("ALCHEMY_API_KEY is not set");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json() as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "Alchemy RPC error");
  return json.result as T;
}

type TokenBalanceEntry = { contractAddress: string; tokenBalance: string | null };
type TokenMetadata = { decimals: number | null; symbol: string | null; name: string | null; logo: string | null };

/** Real Base ERC-20 holdings for a wallet address, priced via DexScreener (lib/basePrices.ts). */
export async function getWalletHoldings(address: string): Promise<WalletTokenHolding[]> {
  const normalized = address.toLowerCase();
  const cached = cache.get(normalized);
  if (cached && Date.now() - cached.at < BALANCE_TTL_MS) return cached.holdings;

  try {
    const { tokenBalances } = await rpc<{ tokenBalances: TokenBalanceEntry[] }>(
      "alchemy_getTokenBalances",
      [address, "erc20"],
    );
    const nonZero = tokenBalances
      .filter((token) => token.tokenBalance && BigInt(token.tokenBalance) > 0n)
      .slice(0, MAX_TOKENS);

    if (nonZero.length === 0) {
      cache.set(normalized, { at: Date.now(), holdings: [] });
      return [];
    }

    const [metas, summaries] = await Promise.all([
      Promise.all(
        nonZero.map((token) =>
          rpc<TokenMetadata>("alchemy_getTokenMetadata", [token.contractAddress]).catch(() => null),
        ),
      ),
      getTokenSummaries(nonZero.map((token) => token.contractAddress)),
    ]);
    const bySummary = new Map(summaries.map((summary) => [summary.address.toLowerCase(), summary]));

    const holdings = nonZero.map((token, i) => {
      const meta = metas[i];
      const decimals = meta?.decimals ?? 18;
      const raw = BigInt(token.tokenBalance ?? "0x0");
      const balance = Number(raw) / 10 ** decimals;
      const summary = bySummary.get(token.contractAddress.toLowerCase());
      const priceUsd = summary?.priceUsd ?? null;
      return {
        address: token.contractAddress,
        symbol: summary?.symbol ?? meta?.symbol ?? "???",
        name: summary?.name ?? meta?.name ?? "Token",
        decimals,
        balance,
        priceUsd,
        valueUsd: priceUsd != null ? balance * priceUsd : null,
        imageUrl: summary?.imageUrl ?? meta?.logo ?? null,
      };
    });
    holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    cache.set(normalized, { at: Date.now(), holdings });
    return holdings;
  } catch {
    return cached?.holdings ?? [];
  }
}
