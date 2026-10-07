import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { challengeTerms } from "@/app/lib/challengeRules";
import { ACCURACY, PINNED_OMENS, RECORDS, STYLES } from "@/app/lib/mockAchievements";
import { FOLLOWED_HANDLES } from "@/app/lib/mockPosts";
import { PORTFOLIOS } from "@/app/lib/mockPortfolios";
import { getProfile, profileActivity } from "@/app/lib/mockProfiles";
import { archetypeFor } from "@/app/lib/profileTraits";
import { VIEWER_RANK, canChallenge, canViewPortfolio, challengeTierNeeded } from "@/app/lib/rank";
import type { ChallengeState } from "@/app/profile/[handle]/ChallengeDialog";
import { HighlightReel } from "@/app/profile/[handle]/HighlightReel";
import { AchievementsPanel, ProfileAchievements } from "@/app/profile/[handle]/ProfileAchievements";
import { ProfileView } from "@/app/profile/[handle]/ProfileView";
import { pendingChallengeTo } from "@/lib/challenges";

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = getProfile(`@${decodeURIComponent(handle)}`);
  if (!profile) notFound();

  // Gate on the server: a locked portfolio is never serialized to the client.
  const portfolioLocked = !canViewPortfolio(profile.rank);
  const portfolio = portfolioLocked ? null : (PORTFOLIOS[profile.handle] ?? null);

  // Rank lock first — it doesn't depend on being signed in (VIEWER_RANK is a
  // stub shared by everyone); then sign-in, then an already-pending challenge.
  const { userId } = await auth();
  let challenge: ChallengeState;
  if (!canChallenge(profile.rank, VIEWER_RANK)) {
    challenge = { kind: "locked", tierNeeded: challengeTierNeeded(profile.rank) };
  } else if (!userId) {
    challenge = { kind: "signed-out" };
  } else {
    const pending = await pendingChallengeTo(userId, profile.handle);
    challenge = pending ? { kind: "pending", id: pending.id, terms: challengeTerms(pending) } : { kind: "ready" };
  }

  const records = RECORDS[profile.handle] ?? null;
  const highlights = PINNED_OMENS[profile.handle] ?? [];

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        activity={profileActivity(profile)}
        portfolio={portfolio}
        portfolioLocked={portfolioLocked}
        viewerRank={VIEWER_RANK}
        initiallyFollowing={FOLLOWED_HANDLES.includes(profile.handle)}
        traits={{ accuracy: ACCURACY[profile.handle] ?? [], archetype: archetypeFor(STYLES[profile.handle]) }}
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
