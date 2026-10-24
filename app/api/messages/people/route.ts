import type { Peer } from "@/app/lib/messageRules";
import { blockedIdsFor } from "@/lib/blocks";
import { friendAccounts } from "@/lib/follows";
import { peersFor } from "@/lib/messages";
import { searchProfiles } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const LIMIT = 8;

/**
 * GET ?q= → { people }: who New message in the Messages dock offers. Empty
 * `q` = your friends (you follow each other); otherwise accounts by handle
 * or name, like the rail search. Never you, nor anyone with a block either way.
 */
export async function GET(request: Request) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/^@/, "").slice(0, 50);
  const [found, blocked] = await Promise.all([query ? searchProfiles(query, LIMIT + 1) : friendAccounts(userId, LIMIT), blockedIdsFor(userId)]);
  const accounts = found.filter((account) => account.userId !== userId && !blocked.has(account.userId)).slice(0, LIMIT);
  const peers = await peersFor(accounts);
  const people: Peer[] = accounts.flatMap((account) => peers.get(account.userId) ?? []);
  return Response.json({ people }, { headers: NO_STORE });
}
