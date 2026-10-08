"use server";

import { auth } from "@clerk/nextjs/server";
import { isExperience, isGoal, isPace, isReferral } from "@/app/lib/onboardingQuestions";
import { isTopicId } from "@/app/lib/topics";
import { saveOnboarding } from "@/lib/onboarding";

export type OnboardingInput = {
  goals: string[];
  experience: string;
  paces: string[];
  interests: string[];
  referral: string | null;
  timezone: string | null;
  adult: boolean;
};

// "America/New_York", "Etc/GMT+5", "UTC".
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

// Unique strings from an untrusted array; anything else becomes [].
const strings = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : []);

/**
 * Last step of /welcome (app/welcome/OnboardingFlow.tsx). The profile step
 * already saved name/handle/bio (saveProfileBasics); this stores the survey.
 * Every id is re-checked against app/lib/onboardingQuestions.ts and unknown
 * ones are dropped. No refresh(): the page redirects finished users away, and
 * the flow still has its finish screen to show.
 */
export async function finishOnboarding(input: OnboardingInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Sign in to finish setting up." };

  const goals = strings(input?.goals).filter(isGoal);
  if (goals.length === 0) return { ok: false, error: "Pick at least one reason you're here." };
  const experience = typeof input.experience === "string" && isExperience(input.experience) ? input.experience : null;
  if (!experience) return { ok: false, error: "Tell us how much trading experience you have." };
  if (input.adult !== true) return { ok: false, error: "Confirm you're 18 or older to continue." };

  await saveOnboarding(userId, {
    goals,
    experience,
    paces: strings(input.paces).filter(isPace),
    interests: strings(input.interests).filter(isTopicId),
    referral: typeof input.referral === "string" && isReferral(input.referral) ? input.referral : null,
    timezone: typeof input.timezone === "string" && TIMEZONE_PATTERN.test(input.timezone) ? input.timezone : null,
  });
  return { ok: true };
}
