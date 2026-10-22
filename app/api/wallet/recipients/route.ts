import { and, eq, ilike, isNotNull, ne, or } from "drizzle-orm";
import { walletJson, walletRateLimit } from "@/app/api/wallet/responses";
import { getDb } from "@/db";
import { profiles, users } from "@/db/schema";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Escapes LIKE wildcards so the query is matched literally. */
function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Other Prophecy users with a handle and an active Base smart account, matched
 * by handle prefix or display-name substring. Only handled users are listed:
 * handles are unique, display names are not, so the picker labels by @handle.
 * Addresses are never returned here, so browsing the directory doesn't map
 * users to wallets. That mapping is not secret: a send intent to a handle
 * returns the resolved address (the sender's browser has to sign the transfer
 * to it), so learning one costs a rate-limited, audited intent per handle.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer?.smartAccountAddress) return walletJson({ error: "Not signed in" }, { status: 401 });
  if (!await walletRateLimit(request, viewer, "wallet-recipients", 60)) {
    return walletJson({ error: "Too many requests" }, { status: 429 });
  }
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50);
  if (q.length < 2) return walletJson({ recipients: [] });

  const literal = likeLiteral(q);
  const rows = await getDb()
    .select({
      handle: profiles.handle,
      displayName: profiles.displayName,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(
      ne(users.id, viewer.userId),
      isNotNull(users.smartAccountAddress),
      isNotNull(profiles.handle),
      eq(users.walletStatus, "active"),
      eq(users.walletChainId, 8453),
      or(ilike(profiles.handle, `${literal.toLowerCase()}%`), ilike(profiles.displayName, `%${literal}%`)),
    ))
    .limit(8);
  return walletJson({ recipients: rows });
}
