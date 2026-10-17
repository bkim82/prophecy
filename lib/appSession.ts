import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSessions, requestRateLimits, users } from "@/db/schema";
import type { CanonicalEmbeddedWallet } from "@/lib/embeddedWalletAccount";

export const APP_SESSION_COOKIE = "__Host-prophecy_session";
export const APP_SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1_000;
export const APP_SESSION_IDLE_MS = 24 * 60 * 60 * 1_000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

export type AppSessionViewer = {
  userId: string;
  smartAccountAddress: string | null;
};

export type IssuedAppSession = AppSessionViewer & {
  token: string;
  expiresAt: Date;
};

export type SessionAuditMetadata = {
  ip: string | null;
  userAgent: string | null;
};

export class SessionConfigurationError extends Error {
  constructor() {
    super("SESSION_SECRET must contain at least 32 characters");
    this.name = "SessionConfigurationError";
  }
}

export class SessionProvisionError extends Error {
  constructor(readonly code: "account-conflict") {
    super(code);
    this.name = "SessionProvisionError";
  }
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new SessionConfigurationError();
  return secret;
}

function keyedHash(purpose: string, value: string) {
  return createHmac("sha256", sessionSecret())
    .update(purpose)
    .update("\0")
    .update(value)
    .digest("hex");
}

export function appSessionTokenHash(token: string) {
  return keyedHash("app-session", token);
}

export function auditValueHash(kind: "ip" | "user-agent", value: string | null) {
  return value ? keyedHash(`audit:${kind}`, value) : null;
}

export function rateLimitKey(scope: string, subject: string) {
  return `${scope}:${keyedHash(`rate-limit:${scope}`, subject)}`;
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/**
 * Upserts the canonical account, revokes previous sessions, and inserts the
 * replacement session in one PostgreSQL statement.
 */
export async function issueAppSession(
  wallet: CanonicalEmbeddedWallet,
  metadata: SessionAuditMetadata,
  now = new Date(),
): Promise<IssuedAppSession> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = appSessionTokenHash(token);
  const expiresAt = new Date(now.getTime() + APP_SESSION_ABSOLUTE_MS);
  const idleExpiresAt = new Date(
    Math.min(expiresAt.getTime(), now.getTime() + APP_SESSION_IDLE_MS),
  );
  const ipHash = auditValueHash("ip", metadata.ip);
  const userAgentHash = auditValueHash("user-agent", metadata.userAgent);

  try {
    const result = await getDb().execute<{ user_id: string }>(sql`
      WITH canonical_user AS (
        INSERT INTO ${users} (
          id, smart_account_address, owner_address, wallet_chain_id,
          wallet_status, wallet_created_at, wallet_updated_at
        )
        VALUES (
          ${wallet.userId}, ${wallet.smartAccountAddress}, ${wallet.ownerAddress},
          ${wallet.chainId}, 'active', ${wallet.createdAt.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          smart_account_address = EXCLUDED.smart_account_address,
          owner_address = EXCLUDED.owner_address,
          wallet_chain_id = EXCLUDED.wallet_chain_id,
          wallet_status = COALESCE(${users.walletStatus}, 'active'),
          wallet_updated_at = EXCLUDED.wallet_updated_at
        WHERE (${users.walletStatus} IS NULL OR ${users.walletStatus} = 'active')
          AND (
            ${users.smartAccountAddress} IS NULL
            OR (
              ${users.smartAccountAddress} = EXCLUDED.smart_account_address
              AND ${users.ownerAddress} = EXCLUDED.owner_address
              AND ${users.walletChainId} = EXCLUDED.wallet_chain_id
            )
          )
        RETURNING id
      ), revoked AS (
        UPDATE ${appSessions}
        SET revoked_at = ${now.toISOString()}::timestamptz
        WHERE user_id = (SELECT id FROM canonical_user)
          AND revoked_at IS NULL
        RETURNING token_hash
      )
      INSERT INTO ${appSessions} (
        token_hash, user_id, issued_at, expires_at, idle_expires_at,
        last_seen_at, ip_hash, user_agent_hash
      )
      SELECT
        ${tokenHash}, id, ${now.toISOString()}::timestamptz,
        ${expiresAt.toISOString()}::timestamptz,
        ${idleExpiresAt.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz, ${ipHash}, ${userAgentHash}
      FROM canonical_user
      RETURNING user_id
    `);

    if (!result.rows[0]) throw new SessionProvisionError("account-conflict");
  } catch (error) {
    if (error instanceof SessionProvisionError) throw error;
    if (isUniqueViolation(error)) throw new SessionProvisionError("account-conflict");
    throw error;
  }

  return {
    token,
    expiresAt,
    userId: wallet.userId,
    smartAccountAddress: wallet.smartAccountAddress,
  };
}

export async function appSessionViewer(token: string, now = new Date()): Promise<AppSessionViewer | null> {
  const tokenHash = appSessionTokenHash(token);
  const [row] = await getDb()
    .select({
      userId: appSessions.userId,
      smartAccountAddress: users.smartAccountAddress,
      expiresAt: appSessions.expiresAt,
      lastSeenAt: appSessions.lastSeenAt,
    })
    .from(appSessions)
    .innerJoin(users, eq(users.id, appSessions.userId))
    .where(and(
      eq(appSessions.tokenHash, tokenHash),
      isNull(appSessions.revokedAt),
      gt(appSessions.expiresAt, now),
      gt(appSessions.idleExpiresAt, now),
    ));
  if (!row) return null;

  if (row.lastSeenAt.getTime() <= now.getTime() - SESSION_TOUCH_INTERVAL_MS) {
    const idleExpiresAt = new Date(
      Math.min(row.expiresAt.getTime(), now.getTime() + APP_SESSION_IDLE_MS),
    );
    await getDb()
      .update(appSessions)
      .set({ lastSeenAt: now, idleExpiresAt })
      .where(and(
        eq(appSessions.tokenHash, tokenHash),
        isNull(appSessions.revokedAt),
        gt(appSessions.expiresAt, now),
        gt(appSessions.idleExpiresAt, now),
        lt(appSessions.lastSeenAt, new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS)),
      ));
  }

  return { userId: row.userId, smartAccountAddress: row.smartAccountAddress };
}

export async function revokeAppSession(token: string, now = new Date()) {
  const [revoked] = await getDb()
    .update(appSessions)
    .set({ revokedAt: now })
    .where(and(
      eq(appSessions.tokenHash, appSessionTokenHash(token)),
      isNull(appSessions.revokedAt),
    ))
    .returning({ tokenHash: appSessions.tokenHash });
  return Boolean(revoked);
}

/**
 * Authenticates the presented session and revokes every live session for its
 * user atomically. Invalid, expired, idle-expired, and already-revoked tokens
 * cannot identify a user or revoke anything.
 */
export async function revokeAllAppSessions(token: string, now = new Date()) {
  const result = await getDb().execute<{ user_id: string | null; revoked_count: number }>(sql`
    WITH current_session AS (
      SELECT ${appSessions.userId} AS user_id
      FROM ${appSessions}
      INNER JOIN ${users} ON ${users.id} = ${appSessions.userId}
      WHERE ${appSessions.tokenHash} = ${appSessionTokenHash(token)}
        AND ${appSessions.revokedAt} IS NULL
        AND ${appSessions.expiresAt} > ${now.toISOString()}::timestamptz
        AND ${appSessions.idleExpiresAt} > ${now.toISOString()}::timestamptz
    ), revoked AS (
      UPDATE ${appSessions}
      SET revoked_at = ${now.toISOString()}::timestamptz
      WHERE user_id = (SELECT user_id FROM current_session)
        AND revoked_at IS NULL
      RETURNING token_hash
    )
    SELECT
      (SELECT user_id FROM current_session) AS user_id,
      (SELECT count(*)::int FROM revoked) AS revoked_count
  `);
  const row = result.rows[0];
  if (!row?.user_id) return null;
  return { userId: row.user_id, revokedCount: row.revoked_count };
}

/** One guarded upsert claims a fixed-window request allowance. */
export async function consumeRateLimit(
  scopeKey: string,
  limit: number,
  windowMs: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError("Invalid rate-limit configuration");
  }

  const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const result = await getDb().execute<{ count: number }>(sql`
    INSERT INTO ${requestRateLimits} (scope_key, window_started_at, count)
    VALUES (${scopeKey}, ${windowStartedAt.toISOString()}::timestamptz, 1)
    ON CONFLICT (scope_key) DO UPDATE SET
      window_started_at = EXCLUDED.window_started_at,
      count = CASE
        WHEN ${requestRateLimits.windowStartedAt} = EXCLUDED.window_started_at
          THEN ${requestRateLimits.count} + 1
        ELSE 1
      END
    WHERE ${requestRateLimits.windowStartedAt} <> EXCLUDED.window_started_at
       OR ${requestRateLimits.count} < ${limit}
    RETURNING count
  `);
  return Boolean(result.rows[0]);
}
