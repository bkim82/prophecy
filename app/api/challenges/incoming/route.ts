import type { IncomingChallenge } from "@/app/lib/challengeRules";
import { playedLabel } from "@/app/lib/playedLabel";
import { incomingChallengesFor } from "@/lib/challenges";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** The caller's pending incoming challenges, newest first, for the header bell. */
export async function GET() {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const now = Date.now();
  const challenges: IncomingChallenge[] = (await incomingChallengesFor(userId)).map((row) => ({
    id: row.id,
    handle: row.challengerHandle ? `@${row.challengerHandle}` : null,
    name: row.challengerName ?? row.challengerHandle ?? "A trader",
    rank: row.challengerRank,
    mode: row.mode,
    market: row.market,
    timerSeconds: row.timerSeconds,
    stake: row.stake,
    sentLabel: playedLabel(row.createdAt.getTime(), now),
  }));
  return Response.json({ challenges }, { headers: { "Cache-Control": "private, no-store" } });
}
