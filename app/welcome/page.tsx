import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { handleProblem } from "@/app/lib/profileEdit";
import { isOnboarded } from "@/lib/onboarding";
import { storedProfileFor } from "@/lib/profile";
import { OnboardingFlow } from "./OnboardingFlow";

// Post-sign-up flow. Every Clerk sign-up lands here (ClerkProvider
// signUpForceRedirectUrl in app/layout.tsx); /profile links back while the
// user has no `onboarding` row. Finished users are sent home.

export const metadata: Metadata = { title: "Welcome — Prophecy" };

// "Ada Lovelace" → "adalovelace". Username first, then the name; never the email,
// since the handle is public. Empty when nothing usable is left.
function suggestedHandle(candidates: (string | null)[]): string {
  for (const candidate of candidates) {
    const handle = (candidate ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, "")
      .replace(/\.{2,}/g, ".")
      .slice(0, 20)
      .replace(/^\.+|\.+$/g, "");
    if (!handleProblem(handle)) return handle;
  }
  return "";
}

export default async function WelcomePage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const [user, stored, onboarded] = await Promise.all([currentUser(), storedProfileFor(userId), isOnboarded(userId)]);
  if (!user) return redirectToSignIn();
  if (onboarded) redirect("/");

  const displayName = stored?.displayName ?? user.fullName ?? user.username ?? "";
  // OnboardingFlow renders the <main>: the welcome card shell, or the
  // tutorial's own arena shell during its tutorial stage.
  return (
    <OnboardingFlow
      profile={{
        displayName,
        handle: stored?.handle ?? suggestedHandle([user.username, user.fullName]),
        bio: stored?.bio ?? "",
        // Clerk always has an imageUrl; without an upload it's a generic default.
        avatarUrl: user.hasImage ? user.imageUrl : null,
        avatarSeed: stored?.handle ? `@${stored.handle}` : userId,
      }}
    />
  );
}
