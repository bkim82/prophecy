import { notFound, redirect } from "next/navigation";
import { challengeTerms } from "@/app/lib/challengeRules";
import { ACCURACY, PINNED_OMENS, RECORDS, STYLES, type ProfileRecords } from "@/app/lib/mockAchievements";
import { PORTFOLIOS } from "@/app/lib/mockPortfolios";
import { getProfile, profileActivity, type Profile } from "@/app/lib/mockProfiles";
import { archetypeFor } from "@/app/lib/profileTraits";
import { canChallenge, canViewPortfolio, challengeTierNeeded } from "@/app/lib/rank";
import type { ChallengeState } from "@/app/profile/[handle]/ChallengeDialog";
import { HighlightReel } from "@/app/profile/[handle]/HighlightReel";
import { AchievementsPanel, ProfileAchievements } from "@/app/profile/[handle]/ProfileAchievements";
import { ProfileView, type ProfileTraits } from "@/app/profile/[handle]/ProfileView";
import { activityFor } from "@/lib/activity";
import { pendingChallengeTo } from "@/lib/challenges";
import { followTarget, followerCount, followingCount, isFollowing } from "@/lib/follows";
import { marketAccuracyFor } from "@/lib/match";
import { rankForUser } from "@/lib/profile";
import { getViewer, providerImagesFor } from "@/lib/viewer";

const joinedFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// A mock trader (app/lib/mockProfiles.ts) or, failing that, a real account
// with that handle (lib/profile.ts publicProfileFor). Real accounts have no
// omens or portfolio here; their accuracy, achievements and trading style come
// from what they played (lib/activity.ts), and their uploaded photo and
// banner show like on their own profile.
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const target = await followTarget(`@${decodeURIComponent(handle)}`);
  if (!target) notFound();
  const userId = (await getViewer())?.userId;
  if (target.userId && target.userId === userId) redirect("/profile");

  // Follows are real both ways; mock traders follow no one, so only real accounts can follow you.
  const [following, followsYou, followers, viewerRank] = await Promise.all([
    userId ? isFollowing(userId, target.key) : false,
    userId && target.userId ? isFollowing(target.userId, userId) : false,
    followerCount(target.key),
    rankForUser(userId),
  ]);

  const mock = getProfile(target.handle);
  const account = target.account;
  let profile: Profile;
  let traits: ProfileTraits;
  let records: ProfileRecords | null;
  if (mock) {
    // The mock's follower count is a baseline; real follows add to it.
    profile = { ...mock, followers: mock.followers + followers };
    traits = { accuracy: ACCURACY[mock.handle] ?? [], archetype: archetypeFor(STYLES[mock.handle]) };
    records = RECORDS[mock.handle] ?? null;
  } else if (account) {
    const [followingTotal, marketAccuracy, providerImages, activity] = await Promise.all([
      followingCount(account.userId),
      marketAccuracyFor(account.userId),
      account.hasAvatarImage ? null : providerImagesFor([account.userId]),
      activityFor(account.userId, target.rank),
    ]);
    const providerImage = providerImages?.get(account.userId);
    // Same precedence as the own profile: app-owned upload, then provider photo, then the gradient initial.
    const version = `handle=${encodeURIComponent(account.handle)}&v=${account.updatedAt.getTime()}`;
    profile = {
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
    traits = {
      accuracy: marketAccuracy
        .filter((row) => row.calls > 0)
        .map((row) => ({ asset: row.market.toUpperCase(), accuracy: row.right / row.calls, calls: row.calls })),
      archetype: archetypeFor(activity.style ?? undefined),
      accuracySource: "Share of their Arena rounds per market that finished in profit",
    };
    records = activity.records;
  } else {
    notFound();
  }

  // Gate on the server: a locked portfolio is never serialized to the client.
  const portfolioLocked = !canViewPortfolio(profile.rank, viewerRank);
  const portfolio = portfolioLocked || !mock ? null : (PORTFOLIOS[mock.handle] ?? null);

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
    challenge = pending ? { kind: "pending", id: pending.id, terms: challengeTerms(pending) } : { kind: "ready" };
  }

  const highlights = mock ? (PINNED_OMENS[mock.handle] ?? []) : [];

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        activity={mock ? profileActivity(mock) : { omens: [], comments: [], trades: [] }}
        portfolio={portfolio}
        portfolioLocked={portfolioLocked}
        viewerRank={viewerRank}
        initiallyFollowing={following}
        signedIn={Boolean(userId)}
        followsYou={followsYou}
        traits={traits}
        challenge={challenge}
        showcase={{
          achievements: <AchievementsPanel records={records} seed={profile.handle} />,
          // HighlightReel renders nothing for a trader with no pins, so don't offer the face.
          reel: highlights.length > 0 ? <HighlightReel highlights={highlights} /> : undefined,
        }}
      />
      <ProfileAchievements records={records} seed={profile.handle}>
        <HighlightReel highlights={highlights} />
      </ProfileAchievements>
    </main>
  );
}
