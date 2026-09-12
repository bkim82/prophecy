import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches } from "@/db/schema";
import {
  expireLocksIfDue,
  findMatch,
  pulsePositionsFor,
  readBody,
  roleOf,
  settleIfDue,
  viewFor,
} from "@/lib/match";
import {
  isPulseLeverage,
  isPulseSide,
  pulseAvailableCash,
  pulsePositionPnl,
  PULSE_STAKE_MAX,
  type PulsePosition,
} from "@/lib/pulse";
import { getSpotPrice, productForMarket } from "@/lib/spotPrice";

export const dynamic = "force-dynamic";

type Action = "enter" | "close";

/** Server-priced, compare-and-swap mutations for a multiplayer Pulse round. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const action = body.action as Action;
  if (!playerId) return Response.json({ error: "Missing playerId" }, { status: 400 });
  if (action !== "enter" && action !== "close") {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const found = await findMatch(id);
  if (!found) return Response.json({ error: "Match not found" }, { status: 404 });
  const role = roleOf(found, playerId);
  if (!role) return Response.json({ error: "Not in this match" }, { status: 403 });
  if (found.mode !== "pulse") return Response.json({ error: "Not a Pulse match" }, { status: 409 });

  const row = await settleIfDue(await expireLocksIfDue(found));
  if (row.status !== "countdown") return Response.json({ error: "Round is not live" }, { status: 409 });
  const product = productForMarket(row.market);
  if (!product) return Response.json({ error: "Unsupported market" }, { status: 400 });
  const current = pulsePositionsFor(row, role);
  const realized = (role === 1 ? row.pulseRealizedPnl1 : row.pulseRealizedPnl2) ?? 0;
  const spot = await getSpotPrice(product);
  if (!spot) return Response.json({ error: "Price unavailable" }, { status: 503 });

  let nextPositions: PulsePosition[];
  let nextRealized = realized;
  if (action === "enter") {
    const side = body.side;
    const stake = Number(body.stake);
    const leverage = Number(body.leverage);
    if (!isPulseSide(side)) return Response.json({ error: "Invalid side" }, { status: 400 });
    if (!Number.isFinite(stake) || stake <= 0 || stake > PULSE_STAKE_MAX) {
      return Response.json({ error: "Invalid stake" }, { status: 400 });
    }
    if (stake > pulseAvailableCash(current, realized)) {
      return Response.json({ error: "Insufficient Pulse balance" }, { status: 409 });
    }
    if (!Number.isInteger(leverage) || !isPulseLeverage(leverage)) {
      return Response.json({ error: "Invalid leverage" }, { status: 400 });
    }
    nextPositions = [...current, {
      id: crypto.randomUUID(), side, entryPrice: spot.price, stake, leverage,
    }];
  } else {
    const positionId = typeof body.positionId === "string" ? body.positionId : "";
    const position = current.find((item) => item.id === positionId);
    if (!position) return Response.json({ error: "Position is already closed" }, { status: 409 });
    nextPositions = current.filter((item) => item.id !== positionId);
    nextRealized += pulsePositionPnl(position, spot.price);
  }

  const [updated] = await getDb()
    .update(matches)
    .set({
      ...(role === 1 ? { pulsePositions1: nextPositions, pulseRealizedPnl1: nextRealized } : {}),
      ...(role === 2 ? { pulsePositions2: nextPositions, pulseRealizedPnl2: nextRealized } : {}),
    })
    .where(and(
      eq(matches.id, id),
      eq(matches.status, "countdown"),
      role === 1
        ? row.pulsePositions1 === null
          ? isNull(matches.pulsePositions1)
          : sql`${matches.pulsePositions1} = ${JSON.stringify(row.pulsePositions1)}::jsonb`
        : row.pulsePositions2 === null
          ? isNull(matches.pulsePositions2)
          : sql`${matches.pulsePositions2} = ${JSON.stringify(row.pulsePositions2)}::jsonb`,
    ))
    .returning();

  if (updated) return Response.json(viewFor(updated, role));
  const latest = await findMatch(id);
  return latest
    ? Response.json(viewFor(latest, role))
    : Response.json({ error: "Match not found" }, { status: 404 });
}
