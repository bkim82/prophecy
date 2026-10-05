// Alchemy wrapper for a connected wallet's real Base ERC-20 holdings. The public Base
// RPC has no way to enumerate "every token this address holds" — that needs an indexer,
// so this is the one place in the app that talks to Alchemy instead of a public RPC.
// Requires ALCHEMY_API_KEY (free tier: alchemy.com -> create a Base Mainnet app).
// Never throws: returns [] (or the last cached result) on any failure, same invariant
// as lib/basePrices.ts.

import { getTokenSummaries } from "./basePrices";

// Shorter than the client's 30s poll so one open tab still gets fresh balances each
// tick; the cache only collapses concurrent callers (several tabs, WalletDesk + dashboard).
const BALANCE_TTL_MS = 20_000;
// The contract list (the two expensive alchemy_getAssetTransfers scans) changes only
// when the wallet touches a new token, so it refreshes far less often than balances,
// and incrementally from the last block seen.
const DISCOVERY_TTL_MS = 5 * 60_000;
const MAX_TOKENS = 25;
const DISCOVERY_MAX_COUNT = 1000;
const BALANCE_BATCH_SIZE = 1000;

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
const inflight = new Map<string, Promise<WalletTokenHolding[]>>();

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
type Erc20Transfer = { blockNum?: string; rawContract?: { address?: string | null } };

type DiscoveryEntry = { at: number; contracts: Set<string>; lastBlock: number | null };
const discoveryCache = new Map<string, DiscoveryEntry>();

// A token's decimals/symbol/name never change, so a successful lookup is kept for
// the life of the instance instead of being re-fetched every refresh.
const metadataCache = new Map<string, TokenMetadata>();

async function getTokenMetadata(contract: string): Promise<TokenMetadata | null> {
  const key = contract.toLowerCase();
  const hit = metadataCache.get(key);
  if (hit) return hit;
  try {
    const meta = await rpc<TokenMetadata>("alchemy_getTokenMetadata", [contract]);
    metadataCache.set(key, meta);
    return meta;
  } catch {
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Every ERC-20 contract this address has ever sent or received, via transfer-log
 * scanning rather than Alchemy's `"erc20"` auto-discovery mode — that mode only
 * covers a curated list of popular tokens by volume, so a real but thinly-traded
 * holding (a new meme coin, say) can silently never appear. Scanning the address's
 * own transfer history instead catches anything it has actually touched.
 * Cached for DISCOVERY_TTL_MS; a refresh only scans blocks after the last one seen.
 */
async function discoverErc20Contracts(address: string): Promise<string[]> {
  const prev = discoveryCache.get(address);
  if (prev && Date.now() - prev.at < DISCOVERY_TTL_MS) return Array.from(prev.contracts);

  const fromBlock = prev?.lastBlock != null ? `0x${prev.lastBlock.toString(16)}` : undefined;
  const fetchSide = async (direction: "fromAddress" | "toAddress") => {
    const { transfers } = await rpc<{ transfers: Erc20Transfer[] }>("alchemy_getAssetTransfers", [
      {
        [direction]: address,
        ...(fromBlock ? { fromBlock } : {}),
        category: ["erc20"],
        excludeZeroValue: false,
        order: "desc",
        maxCount: `0x${DISCOVERY_MAX_COUNT.toString(16)}`,
      },
    ]);
    return transfers;
  };
  const [outgoing, incoming] = await Promise.all([fetchSide("fromAddress"), fetchSide("toAddress")]);
  const contracts = new Set(prev?.contracts);
  let lastBlock = prev?.lastBlock ?? null;
  for (const transfer of [...outgoing, ...incoming]) {
    const contract = transfer.rawContract?.address;
    if (contract) contracts.add(contract.toLowerCase());
    if (transfer.blockNum) {
      const block = parseInt(transfer.blockNum, 16);
      if (lastBlock == null || block > lastBlock) lastBlock = block;
    }
  }
  discoveryCache.set(address, { at: Date.now(), contracts, lastBlock });
  return Array.from(contracts);
}

/** Real Base ERC-20 holdings for a wallet address, priced via DexScreener (lib/basePrices.ts). */
export async function getWalletHoldings(address: string): Promise<WalletTokenHolding[]> {
  const normalized = address.toLowerCase();
  const cached = cache.get(normalized);
  if (cached && Date.now() - cached.at < BALANCE_TTL_MS) return cached.holdings;

  // Concurrent callers for the same wallet share one fetch instead of each missing the cache.
  const pending = inflight.get(normalized);
  if (pending) return pending;
  const promise = fetchWalletHoldings(normalized, cached).finally(() => inflight.delete(normalized));
  inflight.set(normalized, promise);
  return promise;
}

async function fetchWalletHoldings(normalized: string, cached: CacheEntry | undefined): Promise<WalletTokenHolding[]> {
  try {
    const contracts = await discoverErc20Contracts(normalized);
    if (contracts.length === 0) {
      cache.set(normalized, { at: Date.now(), holdings: [] });
      return [];
    }

    const balanceBatches = await Promise.all(
      chunk(contracts, BALANCE_BATCH_SIZE).map((batch) =>
        rpc<{ tokenBalances: TokenBalanceEntry[] }>("alchemy_getTokenBalances", [normalized, batch]),
      ),
    );
    const nonZero = balanceBatches
      .flatMap((result) => result.tokenBalances)
      .filter((token) => token.tokenBalance && BigInt(token.tokenBalance) > 0n);

    if (nonZero.length === 0) {
      cache.set(normalized, { at: Date.now(), holdings: [] });
      return [];
    }

    const [metas, summaries] = await Promise.all([
      Promise.all(nonZero.map((token) => getTokenMetadata(token.contractAddress))),
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
    const limited = holdings.slice(0, MAX_TOKENS);

    cache.set(normalized, { at: Date.now(), holdings: limited });
    return limited;
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
