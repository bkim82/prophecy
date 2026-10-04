import { notFound } from "next/navigation";
import { FeedSidebar } from "@/app/FeedSidebar";
import { FOLLOWED_HANDLES } from "@/app/lib/mockPosts";
import { PORTFOLIOS } from "@/app/lib/mockPortfolios";
import { getProfile, profileActivity } from "@/app/lib/mockProfiles";
import { VIEWER_RANK, canViewPortfolio } from "@/app/lib/rank";
import { ProfileView } from "@/app/profile/[handle]/ProfileView";

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = getProfile(`@${decodeURIComponent(handle)}`);
  if (!profile) notFound();

  // Gate on the server: a locked portfolio is never serialized to the client.
  const portfolioLocked = !canViewPortfolio(profile.rank);
  const portfolio = portfolioLocked ? null : (PORTFOLIOS[profile.handle] ?? null);

  return (
    <main className="feed-shell">
      <ProfileView
        profile={profile}
        activity={profileActivity(profile)}
        portfolio={portfolio}
        portfolioLocked={portfolioLocked}
        viewerRank={VIEWER_RANK}
        initiallyFollowing={FOLLOWED_HANDLES.includes(profile.handle)}
      />
      <FeedSidebar />
    </main>
  );
}
