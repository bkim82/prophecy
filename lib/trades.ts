import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, positions } from "@/db/schema";
import { TRADE_REF, type TradeReceipt } from "@/app/lib/trades";
import { getTokenMetas, getTokenPrices } from "@/lib/basePrices";
import { historyEntryFor, settledMatchesFor, type MatchRow } from "@/lib/match";
import { opponentNames } from "@/lib/opponentNames";
import { positionPnl, settlePortfolioIfDue, type PositionKind, type PositionSide, type PositionRow } from "@/lib/portfolio";
import { PULSE_STARTING_CASH } from "@/lib/pulse";

const ARENA_NAMES: Record<string, string> = { btc: "Bitcoin", eth: "Ethereum", hype: "Hyperliquid" };

/** 24h Portfolio rows → receipts. Open ones are marked live (stale/missing quote → entry, same as portfolioView). */
async function portfolioReceipts(rows: PositionRow[]): Promise<TradeReceipt[]> {
  const open = rows.filter((row) => row.status === "open");
  const [prices, metas] = await Promise.all([
    getTokenPrices(open.map((row) => row.tokenAddress)),
    getTokenMetas(rows.map((row) => row.tokenAddress)),
  ]);
  const priceByAddress = new Map(prices.map((price) => [price.address, price.priceUsd]));
  return rows.map((row) => {
    const isOpen = row.status === "open";
    const exitPrice = isOpen ? (priceByAddress.get(row.tokenAddress) ?? row.entryPrice) : row.exitPrice;
    const pnl = isOpen
      ? positionPnl(
          {
            kind: row.kind as PositionKind,
            qty: row.qty,
            entryPrice: row.entryPrice,
            committedCash: row.committedCash,
            leverage: row.leverage,
            side: row.side as PositionSide | null,
          },
          exitPrice ?? row.entryPrice,
        )
      : (row.realizedPnl ?? 0);
    return {
      id: `portfolio:${row.id}`,
      source: "portfolio",
      symbol: row.tokenSymbol,
      name: row.tokenName,
      imageUrl: metas.get(row.tokenAddress)?.imageUrl ?? null,
      position: row.kind === "spot" ? "spot" : row.side === "short" ? "short" : "long",
      leverage: row.kind === "spot" ? null : row.leverage,
      entryPrice: row.entryPrice,
      exitPrice,
      open: isOpen,
      roiPct: row.committedCash > 0 ? (pnl / row.committedCash) * 100 : 0,
      pnl,
      at: (row.closedAt ?? row.openedAt).getTime(),
    };
  });
}

/** Settled Pulse matches → receipts, each from `userId`'s side of the match. */
async function arenaReceipts(items: { row: MatchRow; userId: string }[]): Promise<TradeReceipt[]> {
  const entries = items.map(({ row, userId }) => historyEntryFor(row, userId));
  const names = await opponentNames(entries.map((entry) => entry.opponentUserId));
  return entries.map((entry) => ({
    id: `arena:${entry.id}`,
    source: "arena",
    symbol: entry.market.toUpperCase(),
    name: ARENA_NAMES[entry.market] ?? entry.market.toUpperCase(),
    imageUrl: null,
    position: "round",
    leverage: null,
    entryPrice: null,
    exitPrice: null,
    open: false,
    roiPct: ((entry.yourProfit ?? 0) / PULSE_STARTING_CASH) * 100,
    pnl: entry.net,
    at: entry.playedAt,
    result: entry.result,
    opponent: (entry.opponentUserId && names.get(entry.opponentUserId)) || "Opponent",
    roundSeconds: entry.timerSeconds,
  }));
}

/**
 * The composer's "attach a trade" list (app/compose/TradePicker.tsx): a
 * user's newest 24h Portfolio positions across every session plus their
 * newest settled Arena rounds, merged newest first. Settles a past-due
 * portfolio session first, like GET /api/portfolio/session, so a session that
 * ended isn't listed as still open.
 */
export async function recentTradesFor(userId: string, limit = 20): Promise<TradeReceipt[]> {
  await settlePortfolioIfDue(userId);

  const [rows, matchRows] = await Promise.all([
    getDb()
      .select()
      .from(positions)
      .where(eq(positions.userId, userId))
      .orderBy(desc(sql`coalesce(${positions.closedAt}, ${positions.openedAt})`))
      .limit(limit),
    settledMatchesFor(userId, limit),
  ]);

  const [portfolio, arena] = await Promise.all([
    portfolioReceipts(rows),
    arenaReceipts(matchRows.map((row) => ({ row, userId }))),
  ]);
  return [...portfolio, ...arena].sort((a, b) => b.at - a.at).slice(0, limit);
}

export const tradeKey = (authorId: string, ref: string) => `${authorId} ${ref}`;

/**
 * Resolves saved posts' trade refs against the DB, live, for whoever is
 * reading: a ref only resolves if that trade is its author's own — their
 * `positions` row, or a settled match they played in (from their side).
 * Anything else is simply absent from the map, and the card says the trade is
 * unavailable. An open position whose 24h session has ended is settled first
 * (settlePortfolioIfDue, idempotent, the same lazy step the Portfolio page
 * runs), so the card shows the real close instead of a stale "Open".
 * Keyed by tradeKey(authorId, ref).
 */
export async function tradeReceiptsFor(refs: { authorId: string; ref: string }[]): Promise<Map<string, TradeReceipt>> {
  const wanted = refs.flatMap(({ authorId, ref }) => {
    const match = TRADE_REF.exec(ref);
    return match ? [{ authorId, ref, source: match[1], id: match[2] }] : [];
  });
  const positionIds = [...new Set(wanted.filter((w) => w.source === "portfolio").map((w) => w.id))];
  const matchIds = [...new Set(wanted.filter((w) => w.source === "arena").map((w) => w.id))];
  const db = getDb();

  const loadPositions = () => (positionIds.length ? db.select().from(positions).where(inArray(positions.id, positionIds)) : Promise.resolve([]));
  let positionRows = await loadPositions();
  const openOwners = [...new Set(positionRows.filter((row) => row.status === "open").map((row) => row.userId))];
  if (openOwners.length > 0) {
    await Promise.all(openOwners.map((userId) => settlePortfolioIfDue(userId)));
    positionRows = await loadPositions();
  }
  const matchRows = matchIds.length
    ? await db.select().from(matches).where(inArray(matches.id, matchIds))
    : [];

  const owned = new Map<string, string>(); // tradeKey → receipt id
  const ownedPositions: PositionRow[] = [];
  const ownedMatches: { row: MatchRow; userId: string }[] = [];
  for (const w of wanted) {
    if (w.source === "portfolio") {
      const row = positionRows.find((candidate) => candidate.id === w.id);
      if (!row || row.userId !== w.authorId) continue;
      if (!ownedPositions.includes(row)) ownedPositions.push(row);
      owned.set(tradeKey(w.authorId, w.ref), w.ref);
    } else {
      const row = matchRows.find((candidate) => candidate.id === w.id);
      if (!row || row.status !== "settled" || (row.player1UserId !== w.authorId && row.player2UserId !== w.authorId)) continue;
      ownedMatches.push({ row, userId: w.authorId });
      owned.set(tradeKey(w.authorId, w.ref), w.ref);
    }
  }

  const [portfolio, arena] = await Promise.all([portfolioReceipts(ownedPositions), arenaReceipts(ownedMatches)]);
  const receipts = new Map<string, TradeReceipt>();
  for (const receipt of portfolio) receipts.set(receipt.id, receipt);
  // Arena receipts differ per side of the match, so they're keyed by author too.
  const arenaByKey = new Map(ownedMatches.map((item, i) => [tradeKey(item.userId, `arena:${item.row.id}`), arena[i]]));

  const out = new Map<string, TradeReceipt>();
  for (const [key, ref] of owned) {
    const receipt = ref.startsWith("arena:") ? arenaByKey.get(key) : receipts.get(ref);
    if (receipt) out.set(key, receipt);
  }
  return out;
}
