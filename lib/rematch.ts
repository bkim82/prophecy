import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, rematches } from "@/db/schema";
import { REMATCH_SECONDS } from "@/app/lib/challengeRules";
import { ensureUser, refundBalance, reserveBalance } from "@/lib/balance";
import { isFresh, type MatchRow } from "@/lib/match";

// "Play again" on a settled challenge round (`matches.invited_user_id` set,
// app/profile/challengeActions.ts acceptChallenge). The first press asks; the
// other seat then has REMATCH_SECONDS to press it too, which opens a new
// private round on the same terms with both players already seated — straight
// into the 5s pre-round countdown. An ask only counts while the asker still
// has the room open (their match heartbeat, lib/match.ts PRESENCE_MS). Stakes
// are reserved from both when the round opens, not on the first press. Times
// use the app-server clock, like lib/match.ts.

const WINDOW_MS = REMATCH_SECONDS * 1000;
const windowCutoff = () => new Date(Date.now() - WINDOW_MS);

type RematchRow = typeof rematches.$inferSelect;

/** One player's view of a settled challenge round's rematch (GET/POST /api/match/[id]/rematch). */
export type RematchView = {
  /** Who pressed Play again last; null if nobody has. An ask with no `expiresInMs` left has lapsed. */
  askedBy: "you" | "opponent" | null;
  /** How long the other player has left to press it too; 0 once it lapsed. */
  expiresInMs: number;
  /** Both pressed it: the round to go to. */
  nextMatchId: string | null;
  /** The other player still has this room open — an ask from someone who left is void. */
  opponentPresent: boolean;
};

export type PlayAgainResult = { ok: true; view: RematchView } | { ok: false; status: number; error: string };

const other = (role: 1 | 2): 1 | 2 => (role === 1 ? 2 : 1);
const userOf = (row: MatchRow, role: 1 | 2) => (role === 1 ? row.player1UserId : row.player2UserId);
const lastSeenOf = (row: MatchRow, role: 1 | 2) => (role === 1 ? row.player1LastSeen : row.player2LastSeen);
const msLeft = (rematch: RematchRow | null) =>
  rematch ? Math.max(0, rematch.requestedAt.getTime() + WINDOW_MS - Date.now()) : 0;

/** True for a settled challenge round between two accounts — the only rounds that offer a rematch. */
export const offersRematch = (row: MatchRow) =>
  row.status === "settled" && row.invitedUserId !== null && row.player1UserId !== null && row.player2UserId !== null;

async function rematchFor(matchId: string): Promise<RematchRow | null> {
  const [row] = await getDb().select().from(rematches).where(eq(rematches.matchId, matchId));
  return row ?? null;
}

function viewOf(row: MatchRow, rematch: RematchRow | null, you: 1 | 2): RematchView {
  return {
    askedBy: rematch === null ? null : rematch.role === you ? "you" : "opponent",
    expiresInMs: rematch?.nextMatchId ? 0 : msLeft(rematch),
    nextMatchId: rematch?.nextMatchId ?? null,
    opponentPresent: isFresh(lastSeenOf(row, other(you))),
  };
}

/** The other seat's ask is still live: inside the window and they're still in the room. */
const theyAsked = (row: MatchRow, rematch: RematchRow | null, you: 1 | 2): rematch is RematchRow =>
  rematch !== null && rematch.nextMatchId === null && rematch.role === other(you) && msLeft(rematch) > 0 && isFresh(lastSeenOf(row, other(you)));

/** `row` is the caller's fresh read of the settled round (touchAndRead, so it carries their heartbeat). */
export async function rematchView(row: MatchRow, you: 1 | 2): Promise<RematchView> {
  return viewOf(row, await rematchFor(row.id), you);
}

/**
 * The caller pressed Play again. Answers the other player's live ask by
 * opening the rematch, otherwise asks (or asks again) themselves. Pressing it
 * again once the rematch is open just hands back its id.
 */
export async function pressPlayAgain(row: MatchRow, you: 1 | 2): Promise<PlayAgainResult> {
  if (!offersRematch(row)) return { ok: false, status: 409, error: "Only a finished challenge round can be replayed." };
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
 * Both pressed it: reserves both stakes, opens the new round with the same
 * seats and terms already in `predict`, then claims the ask for it. A lost
 * claim (the ask lapsed, or a double press opened it first) deletes the new
 * round again and refunds both.
 */
async function openRematch(row: MatchRow, you: 1 | 2): Promise<PlayAgainResult> {
  const db = getDb();
  const yourId = userOf(row, you)!;
  const theirId = userOf(row, other(you))!;
  if (!(await reserveBalance(yourId, row.wager))) return { ok: false, status: 402, error: "You don't have enough Embers for a rematch." };
  if (!(await reserveBalance(theirId, row.wager))) {
    await refundBalance(yourId, row.wager);
    return { ok: false, status: 402, error: "Your opponent doesn't have enough Embers for a rematch anymore." };
  }
  const refundBoth = () => Promise.all([refundBalance(yourId, row.wager), refundBalance(theirId, row.wager)]);

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
      // Still a private challenge round, so it offers a rematch in turn.
      invitedUserId: row.invitedUserId,
      player1LastSeen: now,
      player2LastSeen: now,
      // Both are already in: the 5s pre-round countdown starts now.
      predictStartAt: now,
    });
  } catch (error) {
    await refundBoth();
    throw error;
  }

  const [claimed] = await db
    .update(rematches)
    .set({ nextMatchId })
    .where(and(
      eq(rematches.matchId, row.id),
      isNull(rematches.nextMatchId),
      eq(rematches.role, other(you)),
      gt(rematches.requestedAt, windowCutoff()),
    ))
    .returning();
  if (claimed) return { ok: true, view: viewOf(row, claimed, you) };

  await db.delete(matches).where(eq(matches.id, nextMatchId));
  await refundBoth();
  return { ok: true, view: viewOf(row, await rematchFor(row.id), you) };
}
