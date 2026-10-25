import { notFound, redirect } from "next/navigation";
import { challengeTerms } from "@/app/lib/challengeRules";
import type { Profile } from "@/app/lib/profiles";
import { archetypeFor } from "@/app/lib/profileTraits";
import { canChallenge, canViewPortfolio, challengeTierNeeded } from "@/app/lib/rank";
import type { ChallengeState } from "@/app/profile/[handle]/ChallengeDialog";
import { AchievementsPanel, ProfileAchievements } from "@/app/profile/[handle]/ProfileAchievements";
import { ProfileView, type ProfileTraits } from "@/app/profile/[handle]/ProfileView";
import { activityFor } from "@/lib/activity";
import { blockStateBetween } from "@/lib/blocks";
import { pendingChallengeTo } from "@/lib/challenges";
import { accountActivity } from "@/lib/engagement";
import { followTarget, followerCount, followingCount, isFollowing } from "@/lib/follows";
import { marketAccuracyFor } from "@/lib/match";
import { isOnline } from "@/lib/presence";
import { rankForUser } from "@/lib/profile";
import { getViewer, providerImagesFor } from "@/lib/viewer";

const joinedFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// The account holding that handle (lib/profile.ts publicProfileFor). Its
// omens and comments are what it posted and replied; accuracy, achievements
// and trading style come from what it played (lib/activity.ts); its uploaded
// photo and banner show like on its own profile. No portfolio is shown yet.
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const target = await followTarget(`@${decodeURIComponent(handle)}`);
  if (!target) notFound();
  const userId = (await getViewer())?.userId;
  if (target.userId === userId) redirect("/profile");
  const { account } = target;

  const [following, followsYou, followers, viewerRank] = await Promise.all([
    userId ? isFollowing(userId, target.userId) : false,
    userId ? isFollowing(target.userId, userId) : false,
    followerCount(target.userId),
    rankForUser(userId),
  ]);
  // Only friends see whether someone's online — it gates challenges (lib/presence.ts).
  // A block either way replaces Follow/Message/Challenge.
  const [online, block, followingTotal, marketAccuracy, providerImages, activity, tabs] = await Promise.all([
    following && followsYou ? isOnline(target.userId) : false,
    userId ? blockStateBetween(userId, target.userId) : undefined,
    followingCount(target.userId),
    marketAccuracyFor(target.userId),
    account.hasAvatarImage ? null : providerImagesFor([target.userId]),
    activityFor(target.userId, target.rank),
    accountActivity(target.userId, userId ?? null),
  ]);
  const providerImage = providerImages?.get(target.userId);
  // Same precedence as the own profile: app-owned upload, then provider photo, then the gradient initial.
  const version = `handle=${encodeURIComponent(account.handle)}&v=${account.updatedAt.getTime()}`;
  const profile: Profile = {
    handle: target.handle,
    name: target.name,
    avatarInitial: target.name.charAt(0).toUpperCase(),
    rank: target.rank,
    bio: account.bio ?? "",
    joined: joinedFormat.format(account.joined),
    followers,
    following: followingTotal,
    imageUrl: account.hasAvatarImage ? `/api/profile/avatar?${version}` : (providerImage ?? undefined),
    location: account.location ?? undefined,
    website: account.website ?? undefined,
    banner: account.hasBannerImage
      ? { kind: "image", url: `/api/profile/banner?${version}` }
      : account.bannerPreset
        ? { kind: "preset", id: account.bannerPreset }
        : undefined,
  };
  const traits: ProfileTraits = {
    accuracy: marketAccuracy
      .filter((row) => row.calls > 0)
      .map((row) => ({ asset: row.market.toUpperCase(), accuracy: row.right / row.calls, calls: row.calls })),
    archetype: archetypeFor(activity.style ?? undefined),
    accuracySource: "Share of their Arena rounds per market that finished in profit",
  };
  const { records } = activity;

  const portfolioLocked = !canViewPortfolio(profile.rank, viewerRank);

  // Rank lock first — it doesn't depend on being signed in (signed out ranks
  // as VIEWER_RANK); then sign-in, then an already-pending challenge.
  // The friends-only gate is ChallengeControl's, from `following`/`followsYou`.
  let challenge: ChallengeState;
  if (!canChallenge(profile.rank, viewerRank)) {
    challenge = { kind: "locked", tierNeeded: challengeTierNeeded(profile.rank) };
  } else if (!userId) {
    challenge = { kind: "signed-out" };
  } else {
    const pending = await pendingChallengeTo(userId, profile.handle);
    challenge = pending ? { kind: "pending", id: pending.id, terms: challengeTerms(pending), expiresInMs: pending.expiresInMs } : { kind: "ready" };
  }

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        activity={tabs}
        portfolio={null}
        portfolioLocked={portfolioLocked}
        viewerRank={viewerRank}
        initiallyFollowing={following}
        signedIn={Boolean(userId)}
        followsYou={followsYou}
        online={online}
        messageable
        block={block}
        traits={traits}
        challenge={challenge}
        showcase={{ achievements: <AchievementsPanel records={records} seed={profile.handle} /> }}
      />
      <ProfileAchievements records={records} seed={profile.handle} />
    </main>
  );
}
