import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { FOLLOWED_HANDLES } from "@/app/lib/mockPosts";
import { challengeTerms } from "@/app/lib/challengeRules";
import { getProfile, profileHref, type Profile } from "@/app/lib/mockProfiles";
import type { ProfileBanner } from "@/app/lib/profileEdit";
import { archetypeFor, isPinnableMatch, type Highlight } from "@/app/lib/profileTraits";
import { VIEWER_COPY_EARNINGS, VIEWER_FOLLOWERS, VIEWER_RECORDS, VIEWER_STYLE } from "@/app/lib/mockViewer";
import { VIEWER_RANK } from "@/app/lib/rank";
import { ProfileAchievements } from "@/app/profile/[handle]/ProfileAchievements";
import { ProfileView, type ProfileMatch, type SentChallenge } from "@/app/profile/[handle]/ProfileView";
import { pendingChallengesFrom } from "@/lib/challenges";
import { historyEntryFor, marketAccuracyFor, matchRecordFor, settledMatchesByIds, settledMatchesFor } from "@/lib/match";
import { storedProfileFor } from "@/lib/profile";

// The signed-in viewer's own profile, opened from the header avatar menu
// (app/AccountMenu.tsx). Same layout as /profile/[handle]. Real: Clerk
// photo + join date, everything the Edit profile dialog saves (`profiles`
// table, lib/profile.ts), match history, per-asset accuracy (Arena round
// P&L) and the highlight reel (pinned won matches). The rest is
// app/lib/mockViewer.ts.

const MATCH_LIMIT = 20;
const joinedFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const roundLength = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

// Same style as the feed's mock timestamps ("16m ago").
function playedLabel(playedAt: number, now: number): string {
  const minutes = Math.floor((now - playedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : shortDate.format(playedAt);
}

// Opponents by Clerk @username, else first name (this instance doesn't
// collect usernames) — never a last name or email. "Opponent" when neither
// is set or the lookup fails.
async function opponentNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== null))];
  if (unique.length === 0) return new Map();
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: unique, limit: unique.length });
    return new Map(
      data.flatMap((user) => {
        const name = user.username ? `@${user.username}` : user.firstName;
        return name ? [[user.id, name]] : [];
      }),
    );
  } catch {
    return new Map();
  }
}

export default async function OwnProfilePage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const user = await currentUser();
  if (!user) return redirectToSignIn();

  const [rows, record, stored, marketAccuracy, sent] = await Promise.all([
    settledMatchesFor(userId, MATCH_LIMIT),
    matchRecordFor(userId),
    storedProfileFor(userId),
    marketAccuracyFor(userId),
    pendingChallengesFrom(userId),
  ]);
  // Pins can be older than the listed page, so they're fetched by id — and
  // re-checked, so a pin that stopped qualifying just drops out of the reel.
  const pinnedIds = stored?.pinnedMatches ?? [];
  const pinnedRows = await settledMatchesByIds(userId, pinnedIds);
  const entries = rows.map((row) => historyEntryFor(row, userId));
  const pinnedEntries = pinnedIds
    .map((id) => pinnedRows.find((row) => row.id === id))
    .filter((row) => row !== undefined)
    .map((row) => historyEntryFor(row, userId))
    .filter(isPinnableMatch);
  const names = await opponentNames([...entries, ...pinnedEntries].map((entry) => entry.opponentUserId));
  const now = Date.now();
  const nameFor = (opponentUserId: string | null) => (opponentUserId && names.get(opponentUserId)) || "Opponent";
  const matches: ProfileMatch[] = entries.map((entry) => ({
    ...entry,
    opponentName: nameFor(entry.opponentUserId),
    playedLabel: playedLabel(entry.playedAt, now),
  }));
  const highlights: Highlight[] = pinnedEntries.map((entry) => ({
    kind: "match",
    id: entry.id,
    asset: entry.market.toUpperCase(),
    opponent: nameFor(entry.opponentUserId),
    round: `${roundLength(entry.timerSeconds)} Pulse round · ${entry.wager} Ember stake`,
    profit: entry.yourProfit ?? 0,
    net: entry.net,
    date: playedLabel(entry.playedAt, now),
  }));
  // Targets are mock traders today; fall back to the stored handle/rank if one disappears.
  const challenges: SentChallenge[] = sent.map((row) => {
    const target = getProfile(row.targetHandle);
    return {
      id: row.id,
      handle: row.targetHandle,
      name: target?.name ?? row.targetHandle,
      rank: target?.rank ?? row.targetRank,
      href: profileHref(row.targetHandle),
      terms: challengeTerms(row),
      sentLabel: playedLabel(row.createdAt.getTime(), now),
    };
  });
  const accuracy = marketAccuracy
    .filter((row) => row.calls > 0)
    .map((row) => ({ asset: row.market.toUpperCase(), accuracy: row.right / row.calls, calls: row.calls }));

  const clerkName = user.fullName ?? user.username ?? "You";
  const name = stored?.displayName ?? clerkName;
  // No handle until the user picks one — the hero offers "Choose your @handle".
  const handle = stored?.handle ? `@${stored.handle}` : "";
  const banner: ProfileBanner | undefined = stored?.hasBannerImage
    ? { kind: "image", url: `/api/profile/banner?v=${stored.updatedAt.getTime()}` }
    : stored?.bannerPreset
      ? { kind: "preset", id: stored.bannerPreset }
      : undefined;
  // Clerk always has an imageUrl; without an upload it's a generic default, so use the gradient initial instead.
  const imageUrl = user.hasImage ? user.imageUrl : undefined;
  const profile: Profile = {
    handle,
    name,
    avatarInitial: name.charAt(0).toUpperCase(),
    rank: VIEWER_RANK,
    bio: stored?.bio ?? "",
    joined: joinedFormat.format(user.createdAt),
    followers: VIEWER_FOLLOWERS,
    following: FOLLOWED_HANDLES.length,
    imageUrl,
    location: stored?.location ?? undefined,
    website: stored?.website ?? undefined,
    banner,
  };
  const seed = handle || userId;

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        // Posting isn't persisted (docs/roadmap.md), so the viewer has no omens, comments or trades.
        activity={{ omens: [], comments: [], trades: [] }}
        portfolio={null}
        portfolioLocked={false}
        viewerRank={VIEWER_RANK}
        initiallyFollowing={false}
        traits={{
          accuracy,
          archetype: archetypeFor(VIEWER_STYLE),
          accuracySource: "Share of your Arena rounds per market that finished in profit",
        }}
        highlights={highlights}
        self={{
          pinnedMatchIds: pinnedEntries.map((entry) => entry.id),
          challenges,
          matches,
          record,
          copyEarnings: VIEWER_COPY_EARNINGS,
          edit: {
            displayName: stored?.displayName ?? "",
            namePlaceholder: clerkName,
            handle: stored?.handle ?? "",
            bio: profile.bio,
            location: profile.location ?? "",
            website: profile.website ?? "",
            banner: banner ?? null,
            avatarUrl: imageUrl ?? null,
            avatarInitial: profile.avatarInitial,
            avatarSeed: seed,
          },
        }}
      />
      <ProfileAchievements records={{ ...VIEWER_RECORDS, duelsWon: record.won }} seed={seed} />
    </main>
  );
}
