import { auth } from "@clerk/nextjs/server";
import { historyEntryFor, settledMatchesFor } from "@/lib/match";
import { opponentNames } from "@/lib/opponentNames";

export const dynamic = "force-dynamic";

const LIMIT = 5;

/**
 * GET → { results: [...] } — the signed-in user's newest settled Pulse
 * matches, every market, for the lobby's Recent results list. Same rows and
 * opponent naming as the profile Matches tab (app/profile/page.tsx).
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const entries = (await settledMatchesFor(userId, LIMIT)).map((row) => historyEntryFor(row, userId));
  const names = await opponentNames(entries.map((entry) => entry.opponentUserId));

  return Response.json(
    {
      results: entries.map((entry) => ({
        id: entry.id,
        market: entry.market,
        result: entry.result,
        yourProfit: entry.yourProfit,
        opponentName: (entry.opponentUserId && names.get(entry.opponentUserId)) || "Opponent",
        playedAt: entry.playedAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
