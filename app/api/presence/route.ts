import { acceptedChallengeViews, closeAbandonedRounds, incomingChallengeViews } from "@/lib/challenges";
import { followTarget, isFollowing } from "@/lib/follows";
import { clearPresence, isOnline, touchPresence } from "@/lib/presence";
import { mutationRequestFailure } from "@/lib/requestSecurity";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The header heartbeat (app/LiveChallenges.tsx), every 2s in a visible tab.
 * POST {} → marks you online, closes abandoned challenge rounds you're in
 * (refunding the accepter), and returns { challenges, accepted }: your
 * unexpired incoming challenges, and your sent ones whose round is waiting
 * for you to join, for the bell and its popup (app/lib/liveChallenges.ts).
 * POST { away: true } → offline now (the tab is closing).
 */
export async function POST(request: Request) {
  if (mutationRequestFailure(request)) return Response.json({ error: "Bad request" }, { status: 400 });
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (body && typeof body === "object" && "away" in body && body.away === true) {
    await clearPresence(userId);
    return new Response(null, { status: 204 });
  }
  await Promise.all([touchPresence(userId), closeAbandonedRounds(userId)]);
  const [challenges, accepted] = await Promise.all([incomingChallengeViews(userId), acceptedChallengeViews(userId)]);
  return Response.json({ challenges, accepted }, { headers: NO_STORE });
}

/**
 * GET ?handle= → { online } for a friend's profile, which keeps its Challenge
 * button in step. Only friends (you follow each other) may ask; anyone else
 * gets 404, the same as an unknown handle.
 */
export async function GET(request: Request) {
  const userId = (await getViewer())?.userId;
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const target = await followTarget(new URL(request.url).searchParams.get("handle") ?? "");
  const friends =
    target?.userId &&
    target.userId !== userId &&
    (await Promise.all([isFollowing(userId, target.key), isFollowing(target.userId, userId)])).every(Boolean);
  if (!target?.userId || !friends) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ online: await isOnline(target.userId) }, { headers: NO_STORE });
}
