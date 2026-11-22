import { arenaLobby } from "@/lib/arenaLobby";

export const dynamic = "force-dynamic";

const MARKETS = new Set(["btc", "eth", "nvda"]);

/**
 * GET ?market= → ArenaLobby (app/lib/arenaLobby.ts): recent wins, a featured
 * live round (the given market's first), today's top callers and the online
 * count. Public, no auth — the same real-play data the feed rail shows.
 */
export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market");
  const lobby = await arenaLobby(market && MARKETS.has(market) ? market : null);
  return Response.json(lobby, { headers: { "Cache-Control": "no-store" } });
}
