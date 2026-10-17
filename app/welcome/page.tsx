import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOnboarded } from "@/lib/onboarding";
import { storedProfileFor } from "@/lib/profile";
import { getViewer } from "@/lib/viewer";
import { OnboardingFlow } from "./OnboardingFlow";

// Post-sign-up flow. A sign-in without an `onboarding` row lands here
// (app/auth/AuthProvider.tsx OnboardingRedirect); /profile links back while
// the user has no row. Finished users are sent home.

export const metadata: Metadata = { title: "Welcome — Prophecy" };

export default async function WelcomePage() {
  const userId = (await getViewer())?.userId;
  if (!userId) redirect("/");
  const [stored, onboarded] = await Promise.all([storedProfileFor(userId), isOnboarded(userId)]);
  if (onboarded) redirect("/");

  // OnboardingFlow renders the <main>: the welcome card shell, or the
  // tutorial's own arena shell during its tutorial stage.
  return (
    <OnboardingFlow
      profile={{
        displayName: stored?.displayName ?? "",
        handle: stored?.handle ?? "",
        bio: stored?.bio ?? "",
        avatarUrl: stored?.hasAvatarImage ? "/api/profile/avatar" : null,
        avatarSeed: stored?.handle ? `@${stored.handle}` : userId,
      }}
    />
  );
}
