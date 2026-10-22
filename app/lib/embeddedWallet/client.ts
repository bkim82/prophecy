import type { NormalizedCall } from "./intents";

export type ClientIntent = {
  id: string;
  kind: "send" | "swap";
  chainId: number;
  smartAccountAddress: string;
  tokenIn: string;
  tokenOut: string | null;
  recipient: string;
  inputAmount: string;
  /** Swaps only: the raw minimum output confirmed on review. */
  minimumOutputAmount: string | null;
  calls: NormalizedCall[];
  normalizedCallHash: string;
};

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : "Wallet request failed";
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

/** A token as the server resolved it (curated or Alchemy metadata). */
export type SwapToken = { address: string; symbol: string; decimals: number };

/** Pass exactly one of `recipient` (a pasted address) or `recipientHandle` (resolved server-side). */
export async function createSendIntent(input: {
  idempotencyKey: string;
  tokenAddress: string;
  recipient?: string;
  recipientHandle?: string;
  amount: string;
}) {
  return jsonRequest<{ intent: ClientIntent & { status: string }; token: SwapToken }>("/api/wallet/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "send", ...input }),
  });
}

export async function createSwapIntent(input: {
  idempotencyKey: string;
  fromToken: string;
  toToken: string;
  amount: string;
}) {
  return jsonRequest<{ intent: ClientIntent & { status: string }; fromToken: SwapToken; toToken: SwapToken }>(
    "/api/wallet/intents",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "swap", ...input }),
    },
  );
}

/** A swap passes the raw minimum output its review showed; a send passes nothing. */
export async function confirmIntent(id: string, minimumOutputAmount?: string) {
  return jsonRequest<{ intent: ClientIntent & { status: string } }>(
    `/api/wallet/intents/${encodeURIComponent(id)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minimumOutputAmount === undefined ? {} : { minimumOutputAmount }),
    },
  );
}

export async function claimIntent(id: string) {
  return jsonRequest<{ intent: ClientIntent }>(
    `/api/wallet/intents/${encodeURIComponent(id)}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

export async function reportBroadcast(id: string, userOperationHash: string) {
  return jsonRequest<{ intent: ClientIntent & { status: string } }>(
    `/api/wallet/intents/${encodeURIComponent(id)}/broadcast`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userOperationHash }),
    },
  );
}

/** Backs out of a review: cancels an unclaimed intent. Best effort; the 15-minute sweep is the fallback. */
export async function cancelIntent(id: string) {
  await fetch(`/api/wallet/intents/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}

const PENDING_BROADCASTS_KEY = "wallet.pendingBroadcasts";

function readPendingBroadcasts(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_BROADCASTS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function writePendingBroadcasts(pending: Record<string, string>) {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(PENDING_BROADCASTS_KEY);
    else localStorage.setItem(PENDING_BROADCASTS_KEY, JSON.stringify(pending));
  } catch { /* storage blocked: the hash is lost and reconcile marks the claim dropped */ }
}

/**
 * Keeps a hash CDP returned but the server never recorded, so the next
 * reconcile re-reports it instead of marking a real operation dropped.
 */
export function rememberPendingBroadcast(id: string, userOperationHash: string) {
  writePendingBroadcasts({ ...readPendingBroadcasts(), [id]: userOperationHash });
}

export function hasPendingBroadcasts() {
  return Object.keys(readPendingBroadcasts()).length > 0;
}

async function flushPendingBroadcasts() {
  const pending = readPendingBroadcasts();
  for (const [id, hash] of Object.entries(pending)) {
    const response = await fetch(`/api/wallet/intents/${encodeURIComponent(id)}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userOperationHash: hash }),
    }).catch(() => null);
    // 409: already recorded or no longer revivable; either way stop retrying.
    if (response && (response.ok || response.status === 409)) delete pending[id];
  }
  writePendingBroadcasts(pending);
}

export async function reconcileIntents() {
  await flushPendingBroadcasts();
  return jsonRequest<{ intents: { id: string; status: string }[] }>("/api/wallet/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export type WalletRecipient = { handle: string; displayName: string | null };

export async function searchRecipients(q: string, signal?: AbortSignal) {
  return jsonRequest<{ recipients: WalletRecipient[] }>(
    `/api/wallet/recipients?q=${encodeURIComponent(q)}`,
    { signal, cache: "no-store" },
  );
}
