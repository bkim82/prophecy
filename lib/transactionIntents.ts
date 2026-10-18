import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  transactionIntents,
  walletAuditEvents,
  walletSpendCounters,
} from "@/db/schema";
import {
  IntentValidationError,
  assertSendCalls,
  buildSendIntent,
  normalizeAddress,
  type NormalizedCall,
  type SendIntentInput,
} from "@/app/lib/embeddedWallet/intents";
import { curatedToken, type SendToken } from "@/app/lib/embeddedWallet/tokens";
import { getTokenMetadata } from "@/lib/alchemy";
import { getCdpUserOperation } from "@/lib/cdp";

export type TransactionIntentRow = typeof transactionIntents.$inferSelect;

/**
 * Hashes calls as ordered tuples: `calls` round-trips through jsonb, which
 * reorders object keys, so JSON.stringify of the object form is not stable.
 */
export function callHash(calls: NormalizedCall[]) {
  const tuples = calls.map((call) => [call.to.toLowerCase(), BigInt(call.value).toString(), call.data.toLowerCase()]);
  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

export async function auditWalletEvent(
  event: string,
  userId: string | null,
  targetId: string | null,
  detail?: Record<string, string | number | boolean | null>,
) {
  await getDb().insert(walletAuditEvents).values({
    id: randomUUID(),
    userId,
    event,
    targetId,
    detail: detail ?? null,
  });
}

/** Curated ETH/USDC, else any Base ERC-20 whose decimals Alchemy reports. */
export async function resolveSendToken(address: string): Promise<SendToken | null> {
  const normalized = normalizeAddress(address);
  const curated = curatedToken(normalized);
  if (curated) return curated;
  const meta = await getTokenMetadata(normalized);
  if (meta?.decimals == null || !Number.isInteger(meta.decimals)) return null;
  return {
    address: normalized,
    symbol: meta.symbol?.slice(0, 16) || "token",
    decimals: meta.decimals,
    maxSendRaw: null,
    maxDailyRaw: null,
  };
}

export async function createSendIntent(
  userId: string,
  smartAccountAddress: string,
  input: SendIntentInput,
) {
  const token = await resolveSendToken(input.tokenAddress);
  if (!token) throw new IntentValidationError("unsupported-token", "This token can't be sent.");
  const normalized = buildSendIntent(input, smartAccountAddress, token);
  const hash = callHash(normalized.calls);
  const inserted = await getDb()
    .insert(transactionIntents)
    .values({
      id: randomUUID(),
      schemaVersion: normalized.schemaVersion,
      userId,
      idempotencyKey: input.idempotencyKey,
      kind: normalized.kind,
      chainId: normalized.chainId,
      smartAccountAddress: normalized.smartAccountAddress,
      tokenIn: normalized.token.address,
      recipient: normalized.recipient,
      inputAmount: normalized.rawAmount.toString(),
      calls: normalized.calls,
      normalizedCallHash: hash,
    })
    .onConflictDoNothing({
      target: [transactionIntents.userId, transactionIntents.idempotencyKey],
    })
    .returning();

  const row = inserted[0] ?? (await getDb()
    .select()
    .from(transactionIntents)
    .where(and(
      eq(transactionIntents.userId, userId),
      eq(transactionIntents.idempotencyKey, input.idempotencyKey),
    )))[0];
  if (!row) throw new Error("Could not persist transaction intent");

  if (
    row.kind !== "send"
    || row.smartAccountAddress !== normalized.smartAccountAddress
    || row.tokenIn !== normalized.token.address
    || row.recipient !== normalized.recipient
    || row.inputAmount !== normalized.rawAmount.toString()
    || row.normalizedCallHash !== hash
  ) {
    throw new Error("idempotency-conflict");
  }
  if (inserted[0]) {
    await auditWalletEvent("intent.created", userId, row.id, {
      kind: row.kind,
      token: row.tokenIn,
    });
  }
  return row;
}

export async function listTransactionIntents(userId: string, limit = 50) {
  return getDb()
    .select()
    .from(transactionIntents)
    .where(eq(transactionIntents.userId, userId))
    .orderBy(desc(transactionIntents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getTransactionIntent(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(transactionIntents)
    .where(and(eq(transactionIntents.id, id), eq(transactionIntents.userId, userId)));
  return row ?? null;
}

export async function confirmTransactionIntent(
  userId: string,
  id: string,
  smartAccountAddress: string,
  now = new Date(),
) {
  const [row] = await getDb()
    .update(transactionIntents)
    .set({ status: "confirmed_by_user", updatedAt: now })
    .where(and(
      eq(transactionIntents.id, id),
      eq(transactionIntents.userId, userId),
      eq(transactionIntents.smartAccountAddress, smartAccountAddress.toLowerCase()),
      eq(transactionIntents.status, "created"),
    ))
    .returning();
  if (row) await auditWalletEvent("intent.confirmed", userId, id);
  return row ?? null;
}

/**
 * Atomically claims one confirmed intent. A crash after this point is safe:
 * reconciliation marks a hashless submitted claim as dropped; a retry never
 * signs the operation a second time.
 */
export async function claimTransactionIntent(
  userId: string,
  id: string,
  smartAccountAddress: string,
  now = new Date(),
) {
  const [row] = await getDb()
    .update(transactionIntents)
    .set({ status: "submitted", submissionClaimedAt: now, updatedAt: now })
    .where(and(
      eq(transactionIntents.id, id),
      eq(transactionIntents.userId, userId),
      eq(transactionIntents.smartAccountAddress, smartAccountAddress.toLowerCase()),
      eq(transactionIntents.status, "confirmed_by_user"),
    ))
    .returning();
  if (!row) return null;

  if (row.kind === "send") {
    assertSendCalls({
      tokenAddress: row.tokenIn,
      recipient: row.recipient,
      rawAmount: BigInt(row.inputAmount),
      calls: row.calls,
    });
    if (callHash(row.calls) !== row.normalizedCallHash) {
      await markTransactionTerminal(userId, id, "dropped", "call-hash-mismatch", now);
      return null;
    }
    // Only curated tokens carry a daily cap; others are bounded by balance.
    const token = curatedToken(row.tokenIn);
    const allowed = !token?.maxDailyRaw || await reserveDailySpend(
      userId,
      token.address,
      BigInt(row.inputAmount),
      token.maxDailyRaw,
      now,
    );
    if (!allowed) {
      await markTransactionTerminal(userId, id, "dropped", "daily-limit", now);
      return null;
    }
  }
  await auditWalletEvent("intent.submission_claimed", userId, id);
  return row;
}

export async function reserveDailySpend(
  userId: string,
  tokenAddress: string,
  amount: bigint,
  limit: bigint,
  now = new Date(),
) {
  if (amount <= 0n || limit <= 0n) return false;
  const dayStartedAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const scopeKey = `${userId}:${tokenAddress.toLowerCase()}:${dayStartedAt.toISOString().slice(0, 10)}`;
  const result = await getDb().execute<{ raw_amount: string }>(sql`
    INSERT INTO ${walletSpendCounters} (
      scope_key, user_id, token_address, day_started_at, raw_amount, updated_at
    )
    VALUES (
      ${scopeKey}, ${userId}, ${tokenAddress.toLowerCase()},
      ${dayStartedAt.toISOString()}::timestamptz, ${amount.toString()}::numeric,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (scope_key) DO UPDATE SET
      raw_amount = ${walletSpendCounters.rawAmount} + EXCLUDED.raw_amount,
      updated_at = EXCLUDED.updated_at
    WHERE ${walletSpendCounters.dayStartedAt} = EXCLUDED.day_started_at
      AND ${walletSpendCounters.rawAmount} + EXCLUDED.raw_amount <= ${limit.toString()}::numeric
    RETURNING raw_amount::text
  `);
  return Boolean(result.rows[0]);
}

export async function recordUserOperationHash(
  userId: string,
  id: string,
  userOperationHash: string,
  now = new Date(),
) {
  const normalized = userOperationHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) return null;
  const [row] = await getDb()
    .update(transactionIntents)
    .set({ userOperationHash: normalized, updatedAt: now })
    .where(and(
      eq(transactionIntents.id, id),
      eq(transactionIntents.userId, userId),
      eq(transactionIntents.status, "submitted"),
      sql`${transactionIntents.userOperationHash} IS NULL`,
    ))
    .returning();
  if (row) await auditWalletEvent("intent.broadcast", userId, id);
  return row ?? null;
}

export async function markTransactionTerminal(
  userId: string,
  id: string,
  status: "included" | "reverted" | "dropped" | "replaced" | "canceled",
  failureCode: string | null,
  now = new Date(),
  transactionHash?: string | null,
) {
  const [row] = await getDb()
    .update(transactionIntents)
    .set({
      status,
      failureCode,
      transactionHash: transactionHash?.toLowerCase() ?? undefined,
      updatedAt: now,
    })
    .where(and(
      eq(transactionIntents.id, id),
      eq(transactionIntents.userId, userId),
      sql`${transactionIntents.status} IN ('created', 'confirmed_by_user', 'submitted')`,
    ))
    .returning();
  if (row) await auditWalletEvent(`intent.${status}`, userId, id, { failureCode });
  return row ?? null;
}

/** Bounded on-request reconciliation; a deployment cron may call the same API. */
export async function reconcileTransactionIntents(
  userId: string,
  now = new Date(),
  limit = 10,
) {
  const rows = await getDb()
    .select()
    .from(transactionIntents)
    .where(and(
      eq(transactionIntents.userId, userId),
      eq(transactionIntents.status, "submitted"),
    ))
    .orderBy(transactionIntents.updatedAt)
    .limit(Math.min(Math.max(limit, 1), 25));

  const reconciled: TransactionIntentRow[] = [];
  for (const row of rows) {
    if (!row.userOperationHash) {
      const staleBefore = new Date(now.getTime() - 2 * 60_000);
      if (row.submissionClaimedAt && row.submissionClaimedAt < staleBefore) {
        const dropped = await markTransactionTerminal(
          userId,
          row.id,
          "dropped",
          "submission-interrupted",
          now,
        );
        if (dropped) reconciled.push(dropped);
      }
      continue;
    }
    try {
      const operation = await getCdpUserOperation(
        row.smartAccountAddress,
        row.userOperationHash,
      );
      if (callHash(operation.calls) !== row.normalizedCallHash) {
        const dropped = await markTransactionTerminal(
          userId,
          row.id,
          "dropped",
          "provider-call-mismatch",
          now,
        );
        if (dropped) reconciled.push(dropped);
      } else if (operation.status === "complete" && operation.transactionHash) {
        const included = await markTransactionTerminal(
          userId,
          row.id,
          "included",
          null,
          now,
          operation.transactionHash,
        );
        if (included) reconciled.push(included);
      } else if (operation.status === "failed") {
        const reverted = await markTransactionTerminal(
          userId,
          row.id,
          "reverted",
          "provider-failed",
          now,
          operation.transactionHash,
        );
        if (reverted) reconciled.push(reverted);
      } else if (operation.status === "dropped") {
        const dropped = await markTransactionTerminal(
          userId,
          row.id,
          "dropped",
          "provider-dropped",
          now,
        );
        if (dropped) reconciled.push(dropped);
      }
    } catch {
      // Transient provider failures leave the durable submitted row pending.
    }
  }
  return reconciled;
}
