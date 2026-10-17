import type { NormalizedCall } from "./intents";

export type ClientIntent = {
  id: string;
  kind: "send" | "swap";
  chainId: number;
  smartAccountAddress: string;
  tokenIn: string;
  recipient: string;
  inputAmount: string;
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

export async function createSendIntent(input: {
  idempotencyKey: string;
  tokenAddress: string;
  recipient: string;
  amount: string;
}) {
  return jsonRequest<{ intent: ClientIntent & { status: string } }>("/api/wallet/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "send", ...input }),
  });
}

export async function confirmIntent(id: string) {
  return jsonRequest<{ intent: ClientIntent & { status: string } }>(
    `/api/wallet/intents/${encodeURIComponent(id)}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
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

export async function reconcileIntents() {
  return jsonRequest<{ intents: { id: string; status: string }[] }>("/api/wallet/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}
