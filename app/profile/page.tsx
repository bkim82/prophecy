import { redirect } from "next/navigation";
import { challengeTerms } from "@/app/lib/challengeRules";
import { getProfile, profileHref, type Profile } from "@/app/lib/mockProfiles";
import type { ProfileBanner } from "@/app/lib/profileEdit";
import { archetypeFor, isPinnableMatch, type Highlight } from "@/app/lib/profileTraits";
import { VIEWER_RANK } from "@/app/lib/rank";
import { HighlightReel } from "@/app/profile/[handle]/HighlightReel";
import { AchievementsPanel, ProfileAchievements } from "@/app/profile/[handle]/ProfileAchievements";
import { ProfileView, type ProfileMatch, type SentChallenge } from "@/app/profile/[handle]/ProfileView";
import { NO_COPY_EARNINGS, activityFor } from "@/lib/activity";
import { sentChallengesFrom } from "@/lib/challenges";
import { accountActivity } from "@/lib/engagement";
import { followerCount, followingCount } from "@/lib/follows";
import { historyEntryFor, marketAccuracyFor, matchRecordFor, settledMatchesByIds, settledMatchesFor } from "@/lib/match";
import { opponentNames } from "@/lib/opponentNames";
import { isOnboarded } from "@/lib/onboarding";
import { storedProfileFor } from "@/lib/profile";
import { playedLabel } from "@/app/lib/playedLabel";
import { getViewer, getViewerProfile } from "@/lib/viewer";

// The signed-in viewer's own profile, opened from the header avatar menu
// (app/AccountMenu.tsx). Same layout as /profile/[handle]. Real: join date
// through the viewer adapter, everything the Edit profile dialog saves (`profiles`
// table, lib/profile.ts), match history, per-asset accuracy (Arena round
// P&L), the highlight reel (pinned won matches), follower/following counts
// (lib/follows.ts), and achievements + trading style from what you played
// (lib/activity.ts). Rank is the VIEWER_RANK stub; copy earnings are zero
// until copy trading exists.

const MATCH_LIMIT = 20;
const joinedFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const roundLength = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

export default async function OwnProfilePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  const user = await getViewerProfile(viewer);
  if (!user) redirect("/sign-in");
  const { userId } = viewer;

  const [rows, record, stored, marketAccuracy, sent, onboarded, followers, following, activity, posted] = await Promise.all([
    settledMatchesFor(userId, MATCH_LIMIT),
    matchRecordFor(userId),
    storedProfileFor(userId),
    marketAccuracyFor(userId),
    sentChallengesFrom(userId),
    isOnboarded(userId),
    followerCount(userId),
    followingCount(userId),
    activityFor(userId, VIEWER_RANK),
    accountActivity(userId, userId),
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
  // Mock traders by their mock profile; real accounts by the handle they had when challenged.
  const challenges: SentChallenge[] = sent.map((row) => {
    const target = getProfile(row.targetHandle);
    return {
      id: row.id,
      handle: row.targetHandle,
      name: target?.name ?? row.targetHandle,
      rank: target?.rank ?? row.targetRank,
      href: target ? profileHref(row.targetHandle) : `/profile/${row.targetHandle.slice(1)}`,
      terms: challengeTerms(row),
      declined: row.status === "declined",
      sentLabel: playedLabel(row.createdAt.getTime(), now),
    };
  });
  const accuracy = marketAccuracy
    .filter((row) => row.calls > 0)
    .map((row) => ({ asset: row.market.toUpperCase(), accuracy: row.right / row.calls, calls: row.calls }));

  const accountName = user.displayName;
  const name = stored?.displayName ?? accountName;
  // No handle until the user picks one — the hero offers "Choose your @handle".
  const handle = stored?.handle ? `@${stored.handle}` : "";
  const banner: ProfileBanner | undefined = stored?.hasBannerImage
    ? { kind: "image", url: `/api/profile/banner?v=${stored.updatedAt.getTime()}` }
    : stored?.bannerPreset
      ? { kind: "preset", id: stored.bannerPreset }
      : undefined;
  // Without an app-owned upload, use the gradient initial.
  const imageUrl = stored?.hasAvatarImage
    ? `/api/profile/avatar?v=${stored.updatedAt.getTime()}`
    : user.hasImage && user.imageUrl
      ? user.imageUrl
      : undefined;
  const profile: Profile = {
    handle,
    name,
    avatarInitial: name.charAt(0).toUpperCase(),
    rank: VIEWER_RANK,
    bio: stored?.bio ?? "",
    joined: joinedFormat.format(user.createdAt),
    followers,
    following,
    imageUrl,
    location: stored?.location ?? undefined,
    website: stored?.website ?? undefined,
    banner,
  };
  const seed = handle || userId;
  const { records } = activity;

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        // Your saved omens and replies (lib/engagement.ts); trades aren't listed here yet.
        activity={posted}
        portfolio={null}
        portfolioLocked={false}
        viewerRank={VIEWER_RANK}
        initiallyFollowing={false}
        traits={{
          accuracy,
          archetype: archetypeFor(activity.style ?? undefined),
          accuracySource: "Share of your Arena rounds per market that finished in profit",
        }}
        self={{
          pinnedMatchIds: pinnedEntries.map((entry) => entry.id),
          challenges,
          onboarded,
          matches,
          record,
          copyEarnings: NO_COPY_EARNINGS,
          edit: {
            displayName: stored?.displayName ?? "",
            namePlaceholder: accountName,
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
        showcase={{
          achievements: <AchievementsPanel records={records} seed={seed} />,
          reel: <HighlightReel highlights={highlights} editable />,
        }}
      />
      <ProfileAchievements records={records} seed={seed}>
        <HighlightReel highlights={highlights} editable />
      </ProfileAchievements>
    </main>
  );
}
