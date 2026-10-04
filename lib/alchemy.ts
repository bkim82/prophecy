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
  change24h: number | null;
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
        change24h: summary?.change24h ?? null,
      };
    });
    holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    cache.set(normalized, { at: Date.now(), holdings });
    return holdings;
  } catch {
    return cached?.holdings ?? [];
  }
}

const ACTIVITY_TTL_MS = 15_000;
const ACTIVITY_MAX_PER_SIDE = 25;
const ACTIVITY_LIMIT = 15;

export type WalletActivityKind = "received" | "sent" | "swapped";
export type WalletActivityItem = {
  hash: string;
  kind: WalletActivityKind;
  asset: string;
  value: number | null;
  /** Set only for a "swapped" row: the other leg of the same transaction. */
  toAsset: string | null;
  toValue: number | null;
  timestamp: number | null; // ms epoch
};

type AssetTransfer = {
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  metadata?: { blockTimestamp?: string };
};

const activityCache = new Map<string, { at: number; items: WalletActivityItem[] }>();

async function fetchTransfers(address: string, direction: "fromAddress" | "toAddress"): Promise<AssetTransfer[]> {
  const { transfers } = await rpc<{ transfers: AssetTransfer[] }>("alchemy_getAssetTransfers", [
    {
      [direction]: address,
      category: ["external", "erc20"],
      withMetadata: true,
      excludeZeroValue: true,
      order: "desc",
      maxCount: `0x${ACTIVITY_MAX_PER_SIDE.toString(16)}`,
    },
  ]);
  return transfers;
}

/**
 * Recent on-chain activity for a wallet, newest first. Two same-hash legs (one
 * out, one in, different assets) collapse into one "swapped" row — a same-tx
 * DEX swap always shows this way. A lone leg is "sent"/"received". Real
 * confirmed transfers only: Alchemy has no mempool/pending view here, so
 * there is no "pending" row — never throws, same invariant as getWalletHoldings.
 */
export async function getWalletActivity(address: string): Promise<WalletActivityItem[]> {
  const normalized = address.toLowerCase();
  const cached = activityCache.get(normalized);
  if (cached && Date.now() - cached.at < ACTIVITY_TTL_MS) return cached.items;

  try {
    const [outgoing, incoming] = await Promise.all([
      fetchTransfers(normalized, "fromAddress"),
      fetchTransfers(normalized, "toAddress"),
    ]);

    const byHash = new Map<string, { out?: AssetTransfer; in?: AssetTransfer }>();
    for (const transfer of outgoing) {
      const entry = byHash.get(transfer.hash) ?? {};
      entry.out = transfer;
      byHash.set(transfer.hash, entry);
    }
    for (const transfer of incoming) {
      const entry = byHash.get(transfer.hash) ?? {};
      entry.in = transfer;
      byHash.set(transfer.hash, entry);
    }

    const timeOf = (transfer: AssetTransfer) => {
      const stamp = transfer.metadata?.blockTimestamp;
      return stamp ? Date.parse(stamp) : null;
    };

    const items: WalletActivityItem[] = [];
    for (const [hash, { out, in: incomingLeg }] of byHash) {
      if (out && incomingLeg && out.asset !== incomingLeg.asset) {
        items.push({
          hash,
          kind: "swapped",
          asset: out.asset ?? "?",
          value: out.value,
          toAsset: incomingLeg.asset ?? "?",
          toValue: incomingLeg.value,
          timestamp: timeOf(out) ?? timeOf(incomingLeg),
        });
      } else if (out) {
        items.push({ hash, kind: "sent", asset: out.asset ?? "?", value: out.value, toAsset: null, toValue: null, timestamp: timeOf(out) });
      } else if (incomingLeg) {
        items.push({ hash, kind: "received", asset: incomingLeg.asset ?? "?", value: incomingLeg.value, toAsset: null, toValue: null, timestamp: timeOf(incomingLeg) });
      }
    }
    items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    const limited = items.slice(0, ACTIVITY_LIMIT);

    activityCache.set(normalized, { at: Date.now(), items: limited });
    return limited;
  } catch {
    return cached?.items ?? [];
  }
}
