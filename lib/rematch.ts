import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, rematches } from "@/db/schema";
import { REMATCH_SECONDS } from "@/app/lib/challengeRules";
import { ensureUser, refundBalance, reserveBalance } from "@/lib/balance";
import { botRematchDelayFor, rematchBotState } from "@/lib/bots";
import { isFresh, type MatchRow } from "@/lib/match";

// "Rematch" on any settled round — matchmade, invite link, or challenge. The
// first press asks; the other seat then has REMATCH_SECONDS to press it too,
// which opens a new round on the same terms (private if this one was) with
// both players already seated — straight into the 5s pre-round countdown. An
// ask only counts while the asker still has the room open (their match
// heartbeat, lib/match.ts PRESENCE_MS). A house bot (lib/bots.ts) never asks,
// but presses it too after a short pause, so it rematches like a person.
// Stakes are reserved when the round opens, not on the first press; a bot puts
// up none. Times use the app-server clock, like lib/match.ts.

const WINDOW_MS = REMATCH_SECONDS * 1000;
const windowCutoff = () => new Date(Date.now() - WINDOW_MS);

type RematchRow = typeof rematches.$inferSelect;

/** One player's view of a settled round's rematch (GET/POST /api/match/[id]/rematch). */
export type RematchView = {
  /** Who pressed Rematch last; null if nobody has. An ask with no `expiresInMs` left has lapsed. */
  askedBy: "you" | "opponent" | null;
  /** How long the other player has left to press it too; 0 once it lapsed. */
  expiresInMs: number;
  /** Both pressed it: the round to go to. */
  nextMatchId: string | null;
  /** The other player still has this room open — an ask from someone who left is void. */
  opponentPresent: boolean;
};

export type RematchResult = { ok: true; view: RematchView } | { ok: false; status: number; error: string };

const other = (role: 1 | 2): 1 | 2 => (role === 1 ? 2 : 1);
const userOf = (row: MatchRow, role: 1 | 2) => (role === 1 ? row.player1UserId : row.player2UserId);
const lastSeenOf = (row: MatchRow, role: 1 | 2) => (role === 1 ? row.player1LastSeen : row.player2LastSeen);
const botRoleOf = (row: MatchRow) => row.botState?.role ?? null;
const msLeft = (rematch: RematchRow | null) =>
  rematch ? Math.max(0, rematch.requestedAt.getTime() + WINDOW_MS - Date.now()) : 0;

/** True for a settled round with both seats taken by accounts (a house bot's persona counts). */
export const offersRematch = (row: MatchRow) =>
  row.status === "settled" && row.player1UserId !== null && row.player2UserId !== null;

async function rematchFor(matchId: string): Promise<RematchRow | null> {
  const [row] = await getDb().select().from(rematches).where(eq(rematches.matchId, matchId));
  return row ?? null;
}

function viewOf(row: MatchRow, rematch: RematchRow | null, you: 1 | 2): RematchView {
  return {
    askedBy: rematch === null ? null : rematch.role === you ? "you" : "opponent",
    expiresInMs: rematch?.nextMatchId ? 0 : msLeft(rematch),
    nextMatchId: rematch?.nextMatchId ?? null,
    // A house bot never closes the room.
    opponentPresent: botRoleOf(row) === other(you) || isFresh(lastSeenOf(row, other(you))),
  };
}

/** The other seat's ask is still live: inside the window and they're still in the room. */
const theyAsked = (row: MatchRow, rematch: RematchRow | null, you: 1 | 2): rematch is RematchRow =>
  rematch !== null && rematch.nextMatchId === null && rematch.role === other(you) && msLeft(rematch) > 0 && isFresh(lastSeenOf(row, other(you)));

/** Your live ask to a house bot, once its pause is up: the bot presses it too. */
const botAnswers = (row: MatchRow, rematch: RematchRow | null, you: 1 | 2): rematch is RematchRow =>
  botRoleOf(row) === other(you) && rematch !== null && rematch.nextMatchId === null && rematch.role === you &&
  msLeft(rematch) > 0 && Date.now() - rematch.requestedAt.getTime() >= botRematchDelayFor(row.id);

/**
 * `row` is the caller's fresh read of the settled round (touchAndRead, so it
 * carries their heartbeat). A bot opponent answers your ask from here — your
 * poll is the only thing that runs while you wait on it.
 */
export async function rematchView(row: MatchRow, you: 1 | 2): Promise<RematchView> {
  const rematch = await rematchFor(row.id);
  if (botAnswers(row, rematch, you)) {
    const opened = await openRematch(row, other(you), you);
    if (opened.ok) return opened.view;
  }
  return viewOf(row, rematch, you);
}

/**
 * The caller pressed Rematch. Answers the other player's live ask by
 * opening the rematch, otherwise asks (or asks again) themselves. Pressing it
 * again once the rematch is open just hands back its id.
 */
export async function pressRematch(row: MatchRow, you: 1 | 2): Promise<RematchResult> {
  if (!offersRematch(row)) return { ok: false, status: 409, error: "Only a finished round can be rematched." };
  const rematch = await rematchFor(row.id);
  if (rematch?.nextMatchId) return { ok: true, view: viewOf(row, rematch, you) };
  if (theyAsked(row, rematch, you)) return openRematch(row, you);

  // Asking reserves nothing, but say so now rather than when they answer.
  const user = await ensureUser(userOf(row, you)!);
  if (!user || user.balance < row.wager) return { ok: false, status: 402, error: "You don't have enough Embers for a rematch." };

  // Takes the row unless the other seat holds a live ask; an ask from someone
  // who has since left the room doesn't hold it.
  const now = new Date();
  const opponentGone = !isFresh(lastSeenOf(row, other(you)));
  const [asked] = await getDb()
    .insert(rematches)
    .values({ matchId: row.id, role: you, requestedAt: now })
    .onConflictDoUpdate({
      target: rematches.matchId,
      set: { role: you, requestedAt: now },
      setWhere: and(
        isNull(rematches.nextMatchId),
        or(eq(rematches.role, you), lt(rematches.requestedAt, windowCutoff()), opponentGone ? sql`true` : sql`false`),
      ),
    })
    .returning();
  if (asked) return { ok: true, view: viewOf(row, asked, you) };

  // They asked in the same instant, or already opened it: answer theirs instead.
  const latest = await rematchFor(row.id);
  if (theyAsked(row, latest, you)) return openRematch(row, you);
  return { ok: true, view: viewOf(row, latest, you) };
}

/**
 * Both pressed it: reserves the players' stakes, opens the new round with the
 * same seats and terms already in `predict`, then claims the ask for it. A
 * lost claim (the ask lapsed, or a double press opened it first) deletes the
 * new round again and refunds. `answerer` pressed second; `viewer` is whose
 * view comes back (a bot answers through its opponent's poll).
 */
async function openRematch(row: MatchRow, answerer: 1 | 2, viewer: 1 | 2 = answerer): Promise<RematchResult> {
  const db = getDb();
  const reserved: string[] = [];
  const refundAll = () => Promise.all(reserved.map((userId) => refundBalance(userId, row.wager)));
  // A house bot has no balance and stakes nothing (lib/bots.ts).
  for (const role of [answerer, other(answerer)].filter((seat) => seat !== botRoleOf(row))) {
    const userId = userOf(row, role)!;
    if (!(await reserveBalance(userId, row.wager))) {
      await refundAll();
      const error = role === viewer ? "You don't have enough Embers for a rematch." : "Your opponent doesn't have enough Embers for a rematch anymore.";
      return { ok: false, status: 402, error };
    }
    reserved.push(userId);
  }

  const nextMatchId = crypto.randomUUID();
  const now = new Date();
  try {
    await db.insert(matches).values({
      id: nextMatchId,
      market: row.market,
      mode: row.mode,
      wager: row.wager,
      timerSeconds: row.timerSeconds,
      status: "predict",
      player1Id: row.player1Id,
      player2Id: row.player2Id,
      player1UserId: row.player1UserId,
      player2UserId: row.player2UserId,
      // A private round's rematch stays private.
      invitedUserId: row.invitedUserId,
      // The same bot, if one held a seat, with a fresh brain for the new round.
      botState: row.botState ? rematchBotState(row.botState) : null,
      player1LastSeen: now,
      player2LastSeen: now,
      // Both are already in: the 5s pre-round countdown starts now.
      predictStartAt: now,
    });
  } catch (error) {
    await refundAll();
    throw error;
  }

  const [claimed] = await db
    .update(rematches)
    .set({ nextMatchId })
    .where(and(
      eq(rematches.matchId, row.id),
      isNull(rematches.nextMatchId),
      eq(rematches.role, other(answerer)),
      gt(rematches.requestedAt, windowCutoff()),
    ))
    .returning();
  if (claimed) return { ok: true, view: viewOf(row, claimed, viewer) };

  await db.delete(matches).where(eq(matches.id, nextMatchId));
  await refundAll();
  return { ok: true, view: viewOf(row, await rematchFor(row.id), viewer) };
}
